import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

// The shared live "stage". Every player is a small Chwazi-style puck (white halo
// + colored disc + emoji + name). You can DRAG your own puck anywhere; its
// normalized position streams to everyone (~20Hz) and remote pucks are smoothly
// interpolated, leaving a fading color trail behind movement. Holding a finger
// down (a press without much drag still counts) marks you ready; when everyone
// is ready the server starts a synchronized suspense sweep and then floods the
// winner's color across the screen.
//
// Positions are normalized 0..1 so every device renders the same relative layout.
// All hot state lives in refs read by one rAF loop — network updates never
// re-render React.

const REVEAL_MS = 900; // winner color floods the screen
const LOSER_FADE_MS = 280; // losers shrink + fade
const SEND_MS = 50; // ~20Hz position send
const MOVE_EPS = 0.003; // min normalized move before we send
const LERP = 0.25; // remote puck smoothing per frame
const HOLD_MOVE_TOL = 0.02; // drag farther than this = a move, not just a "hold"
const TRAIL_MS = 380;
const TRAIL_MAX = 22;
const TRAIL_MIN_DIST = 0.004; // normalized

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export default function ArenaScreen({
  me,
  players,
  ready,
  suspense,
  result,
  isHost,
  history,
  positions, // ref: Map<id, { tx, ty }>  (network targets for remote pucks)
  onReadyChange,
  onMove,
  onPlayAgain,
  onLeave,
}) {
  const canvasRef = useRef(null);
  const resultStartRef = useRef(0);

  // Latest props for the rAF loop.
  const stateRef = useRef({});
  stateRef.current = { me, players, ready, suspense, result };

  // My own puck position (normalized) — client-side prediction, rendered raw.
  const myPosRef = useRef({ x: 0.5, y: 0.5 });
  // Rendered (interpolated) positions per id, normalized.
  const renderRef = useRef(new Map());
  // Trails per id: array of { nx, ny, t }.
  const trailRef = useRef(new Map());
  // Drag + hold tracking.
  const dragRef = useRef({ active: false, pointerId: null, offX: 0, offY: 0 });
  const holdRef = useRef(false);
  const downPtRef = useRef(null);
  const currentRRef = useRef(40); // last drawn puck radius (logical px)

  // Seed my position from the roster (e.g. after join/reconnect).
  useEffect(() => {
    if (!me) return;
    const mine = players.find((p) => p.id === me.id);
    if (mine && typeof mine.x === "number") {
      myPosRef.current = { x: mine.x, y: mine.y };
    }
  }, [me, players]);

  // Result: stamp clock + celebrate once.
  useEffect(() => {
    if (result) {
      resultStartRef.current = performance.now();
      const isMe = me && result.chosenPlayerId === me.id;
      confetti({
        particleCount: isMe ? 160 : 110,
        spread: 85,
        origin: { y: 0.45 },
        colors: result.chosenColor ? [result.chosenColor] : undefined,
      });
      if (navigator.vibrate) navigator.vibrate(isMe ? [60, 50, 120] : 60);
    } else {
      resultStartRef.current = 0;
    }
  }, [result, me]);

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
      const readyIds = (ready && ready.readyIds) || [];
      ctx.clearRect(0, 0, w, h);

      const ps = [...players].sort((a, b) => (a.id < b.id ? -1 : 1));
      const n = ps.length || 1;

      // Smaller pucks (research-tuned), responsive to room size.
      const baseR = Math.min(w, h) * (n <= 2 ? 0.075 : n <= 6 ? 0.06 : 0.045);
      const R = Math.max(20, Math.min(baseR, 52));
      currentRRef.current = R;

      const render = renderRef.current;
      const targets = positions.current; // Map<id,{tx,ty}>
      const trails = trailRef.current;

      // Resolve each puck's normalized position: mine = predicted raw; others =
      // lerp toward network target. Seed rendered from target on first sight.
      const posOf = (p) => {
        if (me && p.id === me.id) return myPosRef.current;
        let r = render.get(p.id);
        const t = targets.get(p.id) || { tx: p.x ?? 0.5, ty: p.y ?? 0.5 };
        if (!r) {
          r = { x: t.tx, y: t.ty };
          render.set(p.id, r);
        } else {
          // Snap on big jumps (teleport/rejoin), else smooth.
          if (Math.hypot(t.tx - r.x, t.ty - r.y) > 0.3) {
            r.x = t.tx;
            r.y = t.ty;
          } else {
            r.x += (t.tx - r.x) * LERP;
            r.y += (t.ty - r.y) * LERP;
          }
        }
        return r;
      };

      // Update trails (skip during result — the reveal owns the screen).
      if (!result) {
        for (const p of ps) {
          const pos = posOf(p);
          let arr = trails.get(p.id);
          if (!arr) {
            arr = [];
            trails.set(p.id, arr);
          }
          const last = arr[arr.length - 1];
          if (
            !last ||
            Math.hypot(pos.x - last.nx, pos.y - last.ny) >= TRAIL_MIN_DIST
          ) {
            arr.push({ nx: pos.x, ny: pos.y, t: now });
            if (arr.length > TRAIL_MAX) arr.shift();
          }
          while (arr.length && now - arr[0].t > TRAIL_MS) arr.shift();
        }
      } else {
        trails.clear();
      }

      // ---- result reveal flood (from winner's position) ------------------
      let revealP = 0;
      let winner = null;
      if (result) {
        winner = ps.find((p) => p.id === result.chosenPlayerId) || null;
        revealP = Math.min(1, (now - resultStartRef.current) / REVEAL_MS);
        const wp = winner ? posOf(winner) : { x: 0.5, y: 0.5 };
        const wx = wp.x * w;
        const wy = wp.y * h;
        const maxR = Math.hypot(w, h);
        ctx.save();
        ctx.beginPath();
        ctx.arc(wx, wy, easeOutCubic(revealP) * maxR, 0, Math.PI * 2);
        ctx.fillStyle = result.chosenColor || "#ef4444";
        ctx.globalAlpha = 0.92;
        ctx.fill();
        ctx.restore();
      }

      // ---- suspense sweep ------------------------------------------------
      let sweepP = 0;
      if (suspense) {
        sweepP = Math.min(
          1,
          (Date.now() - suspense.startedAt) / suspense.durationMs
        );
      }

      // ---- trails (under pucks) ------------------------------------------
      if (!result) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const p of ps) {
          const arr = trails.get(p.id);
          if (!arr || arr.length < 2) continue;
          ctx.strokeStyle = p.color;
          for (let i = 1; i < arr.length; i++) {
            const a = arr[i - 1];
            const b = arr[i];
            const age = now - a.t;
            if (age > TRAIL_MS) continue;
            const life = 1 - age / TRAIL_MS;
            const headFrac = i / arr.length;
            ctx.globalAlpha = 0.5 * life;
            ctx.lineWidth = R * (0.22 + 0.62 * headFrac * life);
            ctx.beginPath();
            ctx.moveTo(a.nx * w, a.ny * h);
            ctx.lineTo(b.nx * w, b.ny * h);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // ---- pucks ----------------------------------------------------------
      ps.forEach((p) => {
        const pos = posOf(p);
        const px = pos.x * w;
        const py = pos.y * h;
        const isReady = readyIds.includes(p.id);
        const isWinner = winner && p.id === winner.id;

        let scale = 1;
        let alpha = 1;
        if (result) {
          if (isWinner) {
            scale = 1 + 0.14 * easeOutCubic(Math.min(1, revealP * 1.5));
          } else {
            const t = Math.min(1, (now - resultStartRef.current) / LOSER_FADE_MS);
            scale = 1 - 0.85 * easeOutCubic(t);
            alpha = 1 - easeOutCubic(t);
          }
        } else if (!isReady) {
          alpha = 0.5;
          scale = 0.94;
        }
        if (alpha <= 0.01) return;
        const r = R * scale;

        ctx.save();
        ctx.globalAlpha = alpha;

        // White halo puck.
        ctx.beginPath();
        ctx.arc(px, py, r * 1.26, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();

        // Colored disc.
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        // Suspense sweep ring (holding players, pre-result).
        if (!result && suspense && isReady) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = Math.max(3, r * 0.14);
          ctx.lineCap = "round";
          ctx.arc(
            px,
            py,
            r * 1.14,
            -Math.PI / 2,
            -Math.PI / 2 + Math.PI * 2 * sweepP
          );
          ctx.stroke();
        } else if (!result && isReady) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
          ctx.lineWidth = Math.max(2, r * 0.09);
          ctx.arc(px, py, r * 1.14, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Emoji.
        ctx.globalAlpha = alpha;
        ctx.font = `${Math.round(r * 1.05)}px system-ui, "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.emoji, px, py + r * 0.04);

        // Name.
        ctx.globalAlpha = alpha;
        ctx.font = `600 ${Math.max(11, Math.round(r * 0.4))}px system-ui, sans-serif`;
        ctx.fillStyle = result && !isWinner ? "rgba(255,255,255,0.6)" : "#fff";
        const label = p.name + (me && p.id === me.id ? " ·" : "");
        ctx.fillText(label, px, py + r * 1.7);

        ctx.restore();
      });

      raf = requestAnimationFrame(draw);
    };
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
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  };

  const onPointerDown = (e) => {
    if (result) return; // round over
    const canvas = canvasRef.current;
    const pt = toLogical(e);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const my = myPosRef.current;
    const myx = my.x * w;
    const myy = my.y * h;
    const R = currentRRef.current;
    const grab = R * 1.6;
    const onMyPuck =
      (pt.x - myx) ** 2 + (pt.y - myy) ** 2 <= grab * grab;

    // Begin a hold (marks ready) regardless of where you press.
    if (!holdRef.current) {
      holdRef.current = true;
      onReadyChange(true);
      if (navigator.vibrate) navigator.vibrate(15);
    }
    downPtRef.current = { x: my.x, y: my.y, grabbed: onMyPuck };

    // Grab the puck for dragging if pressed on it (offset keeps it from jumping).
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
    if (!d.active || e.pointerId !== d.pointerId) return;
    if (result) return;
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

  const endPointer = (e) => {
    const d = dragRef.current;
    if (d.pointerId != null) {
      try {
        canvasRef.current.releasePointerCapture(d.pointerId);
      } catch {
        /* ignore */
      }
    }
    // Flush final position.
    if (d.active) {
      const p = myPosRef.current;
      onMove(p.x, p.y);
    }
    dragRef.current = { active: false, pointerId: null, offX: 0, offY: 0 };
    // Release the hold (un-ready).
    if (holdRef.current) {
      holdRef.current = false;
      onReadyChange(false);
    }
  };

  const isMeWinner = me && result && result.chosenPlayerId === me.id;
  const meReady = me && (ready.readyIds || []).includes(me.id);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      />

      {/* Top status */}
      <div className="pointer-events-none absolute top-0 inset-x-0 pt-[max(1rem,env(safe-area-inset-top))] text-center px-4">
        {result ? (
          <p className="text-white text-lg font-bold drop-shadow">
            {isMeWinner ? "It's you! 🎉" : `${result.chosenPlayerName} is chosen`}
          </p>
        ) : suspense ? (
          <p className="text-white/90 text-lg font-bold">Choosing…</p>
        ) : (
          <>
            <p className="text-white/80 text-lg font-medium">
              {ready.readyCount} / {ready.totalCount} holding
            </p>
            <p className="text-white/40 text-sm">
              Drag your circle • everyone hold to choose
            </p>
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
                Play again
              </button>
            ) : (
              <p className="text-center text-white/70">
                Waiting for host to play again…
              </p>
            )}
            <button onClick={onLeave} className="w-full py-2 text-white/50 text-sm">
              Leave
            </button>
          </div>
        ) : (
          <p className="pointer-events-none text-center text-white/50 text-sm">
            {meReady ? "Holding — don't let go ✋" : "Press & hold • drag to move"}
          </p>
        )}
      </div>
    </div>
  );
}
