import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { serverTime } from "../socket";
import { useI18n } from "../i18n.jsx";
import {
  unlock,
  startTone,
  stopTone,
  stopAllTones,
  playReveal,
  setMuted,
  isMuted,
  noteFor,
} from "../audio";

// The shared live "stage", rebuilt to feel like the original finger-chooser. Every
// player is a classic puck (white halo + colored disc) that gently breathes
// and shows a rotating ring while waiting. You DRAG your own puck and HOLD it to
// join the pick; positions stream to everyone (~20Hz, interpolated). When all are
// holding, a synchronized suspense ring fills on every device (clock-synced to
// server time) and then the winner's color floods the screen — exactly like
// pressing fingers on one phone, but across the network.
//
// Modes: "one" (single winner, color flood), "multiple" (N winners, stage dims),
// "groups" (split into N teams, pucks recolor).

const BG = "#212121"; // dark stage (matches body / reveal mask)
const SEND_MS = 50; // ~20Hz position send
const MOVE_EPS = 0.003; // min normalized move before we send
const LERP = 0.25; // remote puck smoothing per frame
const GROW_MS = 120; // bloom-in when a puck appears
const PULSE_MS = 1100; // gentle radius breathing period
// Smoke-puff trail behind moving pucks.
const TRAIL_MS = 600;
const TRAIL_MAX = 30;
const TRAIL_MIN_DIST = 0.0018;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function hexA(hex, a) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function ArenaScreen({
  me,
  players,
  ready,
  suspense,
  result,
  isHost,
  config,
  positions, // ref: Map<id,{tx,ty}>
  onReadyChange,
  onMove,
  onPlayAgain,
  onLeave,
}) {
  const { t } = useI18n();
  const canvasRef = useRef(null);
  const [muted, setMutedState] = useState(isMuted());

  const stateRef = useRef({});
  stateRef.current = { me, players, ready, suspense, result };

  const myPosRef = useRef({ x: 0.5, y: 0.5 });
  const renderRef = useRef(new Map()); // interpolated remote positions
  const trailRef = useRef(new Map());
  const seenRef = useRef(new Map()); // id -> first-seen time (for grow-in)
  const dragRef = useRef({ active: false, pointerId: null, offX: 0, offY: 0 });
  const holdRef = useRef(false);
  const currentRRef = useRef(40);
  const revealDoneRef = useRef(false);

  // Seed my position from the roster (after join/reconnect).
  useEffect(() => {
    if (!me) return;
    const mine = players.find((p) => p.id === me.id);
    if (mine && typeof mine.x === "number") myPosRef.current = { x: mine.x, y: mine.y };
  }, [me, players]);

  // ---- audio: a warm tone per holding finger (the "jam session") -----------
  const noteIndex = (id) => {
    const ids = players.map((p) => p.id).sort();
    const i = ids.indexOf(id);
    return i < 0 ? 0 : i;
  };
  useEffect(() => {
    if (result) return; // tones stop at reveal (handled below)
    const readyIds = new Set(ready.readyIds || []);
    // start tones for newly-holding players
    for (const id of readyIds) startTone(id, noteFor(noteIndex(id)));
    // stop tones for players who let go
    for (const p of players) if (!readyIds.has(p.id)) stopTone(p.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.readyIds, result]);

  // ---- result: chime + confetti + stop the hum -----------------------------
  useEffect(() => {
    if (result) {
      stopAllTones();
      if (!revealDoneRef.current) {
        revealDoneRef.current = true;
        const amWinner =
          (result.winners || []).some((w) => me && w.id === me.id) || false;
        const floodColor =
          (result.winners && result.winners[0] && result.winners[0].color) || "#ef5350";
        playReveal();
        if (navigator.vibrate) navigator.vibrate(200);
        confetti({
          particleCount: amWinner ? 170 : 110,
          spread: 88,
          origin: { y: 0.45 },
          colors: result.mode === "groups" ? undefined : [floodColor],
        });
      }
    } else {
      revealDoneRef.current = false;
    }
    return () => {};
  }, [result, me]);

  useEffect(() => () => stopAllTones(), []);

  // ---- throttled position send --------------------------------------------
  const sendStateRef = useRef({ lastAt: 0, lastX: -1, lastY: -1, timer: null });
  const queueSend = (nx, ny) => {
    const s = sendStateRef.current;
    s.pending = { nx, ny };
    const now = performance.now();
    const due = s.lastAt + SEND_MS - now;
    const flush = () => {
      s.timer = null;
      if (!s.pending) return;
      const moved =
        Math.abs(s.pending.nx - s.lastX) > MOVE_EPS ||
        Math.abs(s.pending.ny - s.lastY) > MOVE_EPS;
      if (moved) {
        onMove(s.pending.nx, s.pending.ny);
        s.lastX = s.pending.nx;
        s.lastY = s.pending.ny;
        s.lastAt = performance.now();
      }
      s.pending = null;
    };
    if (due <= 0) flush();
    else if (!s.timer) s.timer = setTimeout(flush, due);
  };

  // ---- render loop ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const { players, ready, suspense, result, me } = stateRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const now = performance.now();
      const st = serverTime();
      const readyIds = (ready && ready.readyIds) || [];
      ctx.clearRect(0, 0, w, h);

      const ps = [...players].sort((a, b) => (a.id < b.id ? -1 : 1));
      const n = ps.length || 1;

      // Responsive puck radius (fraction of min dimension, like the original),
      // shrinking as the table fills.
      const frac = n <= 2 ? 0.085 : n <= 4 ? 0.07 : n <= 8 ? 0.055 : 0.045;
      const R = Math.max(22, Math.min(Math.min(w, h) * frac, 64));
      currentRRef.current = R;

      const render = renderRef.current;
      const targets = positions.current;
      const trails = trailRef.current;
      const seen = seenRef.current;

      const posOf = (p) => {
        if (me && p.id === me.id) return myPosRef.current;
        let r = render.get(p.id);
        const t = targets.get(p.id) || { tx: p.x ?? 0.5, ty: p.y ?? 0.5 };
        if (!r) {
          r = { x: t.tx, y: t.ty };
          render.set(p.id, r);
        } else if (Math.hypot(t.tx - r.x, t.ty - r.y) > 0.3) {
          r.x = t.tx;
          r.y = t.ty;
        } else {
          r.x += (t.tx - r.x) * LERP;
          r.y += (t.ty - r.y) * LERP;
        }
        return r;
      };

      // grow-in bookkeeping
      for (const p of ps) if (!seen.has(p.id)) seen.set(p.id, now);
      const growth = (id) => Math.min(1, (now - (seen.get(id) || now)) / GROW_MS);

      // result lookups
      const winners = result && result.winners ? result.winners : null;
      const winnerSet = winners ? new Set(winners.map((wv) => wv.id)) : null;
      const groups = result && result.groups ? result.groups : null;
      const groupMap = groups ? new Map(groups.map((gv) => [gv.id, gv])) : null;
      const colorOf = (p) => (groupMap && groupMap.get(p.id) ? groupMap.get(p.id).color : p.color);

      // === SINGLE-WINNER FLOOD ============================================
      if (result && result.mode === "one" && winners && winners[0]) {
        const wp = ps.find((p) => p.id === winners[0].id);
        const wpos = wp ? posOf(wp) : { x: 0.5, y: 0.5 };
        const wx = wpos.x * w;
        const wy = wpos.y * h;
        const revealP = Math.min(1, Math.max(0, (st - result.revealAt) / result.durationMs));
        const e = easeOutCubic(revealP);
        // flood whole stage with winner color
        ctx.fillStyle = winners[0].color;
        ctx.fillRect(0, 0, w, h);
        // shrinking dark mask centered on winner -> color floods inward
        const maxDim = Math.hypot(w, h);
        const maskR = (1 - e) * maxDim + R * 1.7;
        ctx.beginPath();
        ctx.arc(wx, wy, maskR, 0, Math.PI * 2);
        ctx.fillStyle = BG;
        ctx.fill();
        // winner puck sits in the dark disc
        if (wp) drawPuck(ctx, wp, wx, wy, R, winners[0].color, 1, 1 + 0.05 * e, true, true);
        raf = requestAnimationFrame(draw);
        return;
      }

      // === MULTIPLE-WINNER / NORMAL / GROUPS ==============================
      // smoke trails (only while playing, not during reveal)
      if (!result) {
        for (const p of ps) {
          const pos = posOf(p);
          let arr = trails.get(p.id);
          if (!arr) {
            arr = [];
            trails.set(p.id, arr);
          }
          const last = arr[arr.length - 1];
          if (!last || Math.hypot(pos.x - last.nx, pos.y - last.ny) >= TRAIL_MIN_DIST) {
            arr.push({ nx: pos.x, ny: pos.y, t: now });
            if (arr.length > TRAIL_MAX) arr.shift();
          }
          while (arr.length && now - arr[0].t > TRAIL_MS) arr.shift();
        }
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const p of ps) {
          const arr = trails.get(p.id);
          if (!arr || arr.length < 1) continue;
          for (let i = 0; i < arr.length; i++) {
            const pt = arr[i];
            const age = now - pt.t;
            if (age > TRAIL_MS) continue;
            const life = 1 - age / TRAIL_MS;
            const headFrac = (i + 1) / arr.length;
            const rad = R * (0.55 + (1 - life) * 0.9) * (0.5 + 0.5 * headFrac);
            const px = pt.nx * w;
            const py = pt.ny * h;
            const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
            const coreA = 0.4 * life * (0.45 + 0.55 * headFrac);
            g.addColorStop(0, hexA(p.color, coreA));
            g.addColorStop(0.55, hexA(p.color, coreA * 0.5));
            g.addColorStop(1, hexA(p.color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px, py, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      } else {
        trails.clear();
      }

      // multi-winner: dim the stage so winners pop
      let revealP = 0;
      if (result && result.mode === "multiple") {
        revealP = Math.min(1, Math.max(0, (st - result.revealAt) / result.durationMs));
        ctx.fillStyle = `rgba(15,15,15,${0.72 * easeOutCubic(revealP)})`;
        ctx.fillRect(0, 0, w, h);
      } else if (result && result.mode === "groups") {
        revealP = Math.min(1, Math.max(0, (st - result.revealAt) / result.durationMs));
      }

      // suspense sweep progress (clock-synced)
      let sweepP = 0;
      if (suspense) sweepP = Math.min(1, Math.max(0, (st - suspense.startAt) / suspense.durationMs));

      // pucks
      ps.forEach((p) => {
        const pos = posOf(p);
        const px = pos.x * w;
        const py = pos.y * h;
        const isReady = readyIds.includes(p.id);
        const g = growth(p.id);

        let scale = g;
        let alpha = g;

        if (result) {
          if (result.mode === "multiple") {
            if (winnerSet.has(p.id)) {
              scale = 1 + 0.12 * easeOutCubic(revealP);
              alpha = 1;
            } else {
              const e = easeOutCubic(revealP);
              scale = 1 - 0.85 * e;
              alpha = 1 - e;
            }
          } else if (result.mode === "groups") {
            scale = 1 + 0.04 * Math.sin(now / 400);
            alpha = 1;
          }
        } else {
          // idle/waiting: gentle breathing pulse + dim if not holding
          const pulse = 1 + 0.035 * Math.sin((now / PULSE_MS) * Math.PI * 2 + noteIndex(p.id));
          scale = g * pulse;
          if (!isReady) alpha = g * 0.55;
        }
        if (alpha <= 0.01) return;
        const col = colorOf(p);
        const r = R * scale;
        const isWin = winnerSet && winnerSet.has(p.id);

        drawPuck(ctx, p, px, py, r / scale, col, alpha, scale, isWin, !!result);

        // rings (only while playing)
        if (!result) {
          ctx.save();
          ctx.globalAlpha = alpha;
          if (suspense && isReady) {
            // clock-sweep fill: shows the synchronized pick countdown
            ctx.beginPath();
            ctx.strokeStyle = "rgba(255,255,255,0.95)";
            ctx.lineWidth = Math.max(3, r * 0.14);
            ctx.lineCap = "round";
            ctx.arc(px, py, r * 1.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweepP);
            ctx.stroke();
          } else {
            // alive rotating arc-gap ring (breathes); brighter when holding
            const t = now / 1000 + noteIndex(p.id);
            const gap = 0.5 + 0.35 * Math.sin(t * 1.6);
            const start = t * 1.4;
            ctx.beginPath();
            ctx.strokeStyle = isReady ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)";
            ctx.lineWidth = Math.max(2, r * (isReady ? 0.11 : 0.08));
            ctx.lineCap = "round";
            ctx.arc(px, py, r * 1.32, start, start + Math.PI * 2 - gap);
            ctx.stroke();
          }
          ctx.restore();
        }

        // group number badge
        if (result && result.mode === "groups" && groupMap.get(p.id)) {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.font = `800 ${Math.round(r * 0.6)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(groupMap.get(p.id).group), px, py - r * 1.55);
          ctx.restore();
        }
      });

      raf = requestAnimationFrame(draw);
    };

    // Puck drawing helper (kept inside effect to capture ctx conventions).
    function drawPuck(ctx, p, px, py, baseR, color, alpha, scale, emphasized, showName) {
      const r = baseR * scale;
      const me2 = stateRef.current.me;
      const isMe = me2 && p.id === me2.id;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (emphasized) {
        ctx.shadowColor = color;
        ctx.shadowBlur = r * 0.9;
      }
      // white halo
      ctx.beginPath();
      ctx.arc(px, py, r * 1.18, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.fill();
      // colored disc
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      // "you" marker: a small white dot in the center of your own puck, so you
      // can find your circle without any name showing during the round.
      if (isMe && !showName) {
        ctx.beginPath();
        ctx.arc(px, py, r * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();
      }
      // name — only at the final reveal, never during the round
      if (showName) {
        ctx.font = `700 ${Math.max(12, Math.round(r * 0.42))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.fillText(p.name, px, py + r * 1.62);
      }
      ctx.restore();
    }

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [positions]);

  // ---- pointer: drag my puck + hold-to-ready ------------------------------
  const toLogical = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.clientWidth / rect.width;
    const sy = canvas.clientHeight / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const onPointerDown = (e) => {
    if (result) return;
    unlock(); // start audio inside the user gesture
    const canvas = canvasRef.current;
    const pt = toLogical(e);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const my = myPosRef.current;
    const myx = my.x * w;
    const myy = my.y * h;
    const R = currentRRef.current;
    const grab = R * 1.6;
    const onMyPuck = (pt.x - myx) ** 2 + (pt.y - myy) ** 2 <= grab * grab;
    if (!onMyPuck) return; // only the puck is interactive

    if (!holdRef.current) {
      holdRef.current = true;
      onReadyChange(true);
      if (me) startTone(me.id, noteFor(noteIndex(me.id)));
      if (navigator.vibrate) navigator.vibrate(15);
    }
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      offX: my.x - pt.x / w,
      offY: my.y - pt.y / h,
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId || result) return;
    const canvas = canvasRef.current;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pt = toLogical(e);
    const R = currentRRef.current;
    const marginX = R / w;
    const marginY = R / h;
    const nx = Math.min(1 - marginX, Math.max(marginX, pt.x / w + d.offX));
    const ny = Math.min(1 - marginY, Math.max(marginY, pt.y / h + d.offY));
    myPosRef.current = { x: nx, y: ny };
    queueSend(nx, ny);
  };

  const endPointer = () => {
    const d = dragRef.current;
    if (d.pointerId != null) {
      try {
        canvasRef.current.releasePointerCapture(d.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (d.active) {
      const p = myPosRef.current;
      onMove(p.x, p.y);
    }
    dragRef.current = { active: false, pointerId: null, offX: 0, offY: 0 };
    if (holdRef.current) {
      holdRef.current = false;
      onReadyChange(false);
      if (me) stopTone(me.id);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  const meReady = me && (ready.readyIds || []).includes(me.id);
  const amWinner = result && (result.winners || []).some((wv) => me && wv.id === me.id);
  const headline = !result
    ? null
    : result.mode === "groups"
    ? t("teamsResult", { n: result.count })
    : result.mode === "multiple"
    ? t("multipleChosen", { names: (result.winners || []).map((wv) => wv.name).join(", ") })
    : amWinner
    ? t("youWin")
    : t("chosen", { name: result.winners[0].name });

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: BG }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      />

      {/* Mute toggle */}
      <button
        onClick={toggleMute}
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-10 w-10 h-10 rounded-full bg-white/10 active:bg-white/20 text-lg flex items-center justify-center"
        aria-label={muted ? t("unmute") : t("mute")}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* Top status */}
      <div className="pointer-events-none absolute top-0 inset-x-0 pt-[max(1rem,env(safe-area-inset-top))] text-center px-4">
        {result ? (
          <p className="text-white text-xl font-bold drop-shadow">{headline}</p>
        ) : suspense ? (
          <p className="text-white/95 text-xl font-bold">{t("choosing")}</p>
        ) : (
          <>
            <p className="text-white/85 text-lg font-medium">
              {t("holding", { ready: ready.readyCount, total: ready.totalCount })}
            </p>
            <p className="text-white/40 text-sm">{t("holdHint")}</p>
          </>
        )}
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 inset-x-0 pb-[max(1.25rem,env(safe-area-inset-bottom))] px-4">
        {result ? (
          <div className="w-full max-w-sm mx-auto space-y-2">
            {isHost ? (
              <button
                onClick={onPlayAgain}
                className="w-full py-4 rounded-2xl bg-white text-black active:bg-white/80 font-bold text-lg transition"
              >
                {t("playAgain")}
              </button>
            ) : (
              <p className="text-center text-white/70">{t("waitingPlayAgain")}</p>
            )}
            <button onClick={onLeave} className="w-full py-2 text-white/50 text-sm">
              {t("leave")}
            </button>
          </div>
        ) : (
          <p className="pointer-events-none text-center text-white/50 text-sm">
            {meReady ? t("holdingDontLetGo") : t("holdToJoin")}
          </p>
        )}
      </div>
    </div>
  );
}
