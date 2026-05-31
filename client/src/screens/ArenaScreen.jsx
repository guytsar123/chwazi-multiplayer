import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

// The shared live "stage". Every device shows the SAME layout of all players as
// Chwazi-style pucks (white halo + colored disc + emoji), arranged on a circle
// ordered by player id so it's identical everywhere. Players who are holding a
// finger light up live. When the server says everyone is holding it broadcasts a
// synchronized `suspense` window — each holding puck's ring sweeps clockwise in
// lockstep — and on the result the losers shrink away while the winner's color
// floods the screen.
//
// Drawing is done on a canvas via requestAnimationFrame for smooth sweeps/flood;
// the hold button and host controls are HTML overlays on top.

const REVEAL_MS = 900; // winner color floods the screen
const LOSER_FADE_MS = 280; // losers shrink + fade

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
  onReadyChange,
  onPlayAgain,
  onLeave,
}) {
  const canvasRef = useRef(null);
  const holdingRef = useRef(false);
  const resultStartRef = useRef(0);

  // Keep the latest props in a ref so the rAF loop always reads fresh values
  // without restarting.
  const stateRef = useRef({});
  stateRef.current = { me, players, ready, suspense, result };

  // Stamp when a result first arrives (for the reveal animation clock) and fire
  // confetti + haptics once.
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

  // The render loop.
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

      // Stable identical ordering across devices.
      const ps = [...players].sort((a, b) => (a.id < b.id ? -1 : 1));
      const n = ps.length || 1;

      // Layout: a centered ring of pucks (single player sits in the middle).
      const cx = w / 2;
      const cy = h / 2;
      const layoutR = n === 1 ? 0 : Math.min(w, h) * 0.32;
      // Puck size shrinks as the room grows.
      const baseR = Math.min(w, h) * (n <= 2 ? 0.16 : n <= 6 ? 0.12 : 0.085);
      const R = Math.max(26, Math.min(baseR, 70));

      // ---- result reveal background flood --------------------------------
      let revealP = 0;
      let winner = null;
      if (result) {
        winner = ps.find((p) => p.id === result.chosenPlayerId) || null;
        revealP = Math.min(1, (now - resultStartRef.current) / REVEAL_MS);
        const eased = easeOutCubic(revealP);
        // Find winner position to flood out from.
        const wi = ps.findIndex((p) => p.id === result.chosenPlayerId);
        const wAng = -Math.PI / 2 + (wi / n) * Math.PI * 2;
        const wx = n === 1 ? cx : cx + Math.cos(wAng) * layoutR;
        const wy = n === 1 ? cy : cy + Math.sin(wAng) * layoutR;
        const maxR = Math.hypot(w, h);
        ctx.save();
        ctx.beginPath();
        ctx.arc(wx, wy, eased * maxR, 0, Math.PI * 2);
        ctx.fillStyle = result.chosenColor || "#ef4444";
        ctx.globalAlpha = 0.92;
        ctx.fill();
        ctx.restore();
      }

      // ---- suspense sweep progress ---------------------------------------
      let sweepP = 0;
      if (suspense) {
        sweepP = Math.min(
          1,
          (Date.now() - suspense.startedAt) / suspense.durationMs
        );
      }

      // ---- draw each puck ------------------------------------------------
      ps.forEach((p, i) => {
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const px = n === 1 ? cx : cx + Math.cos(ang) * layoutR;
        const py = n === 1 ? cy : cy + Math.sin(ang) * layoutR;

        const isReady = readyIds.includes(p.id);
        const isWinner = winner && p.id === winner.id;

        let scale = 1;
        let alpha = 1;

        if (result) {
          if (isWinner) {
            // Winner gently pops.
            scale = 1 + 0.12 * easeOutCubic(Math.min(1, revealP * 1.5));
          } else {
            // Losers shrink + fade.
            const t = Math.min(1, (now - resultStartRef.current) / LOSER_FADE_MS);
            scale = 1 - 0.85 * easeOutCubic(t);
            alpha = 1 - easeOutCubic(t);
          }
        } else if (!isReady) {
          // Not holding yet: dimmed and slightly smaller.
          alpha = 0.4;
          scale = 0.92;
        }

        if (alpha <= 0.01) return;
        const r = R * scale;

        ctx.save();
        ctx.globalAlpha = alpha;

        // White halo "puck".
        ctx.beginPath();
        ctx.arc(px, py, r * 1.28, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();

        // Colored disc.
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        // Synchronized suspense ring (only for holding players, pre-result).
        if (!result && suspense && isReady) {
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = Math.max(3, r * 0.12);
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
          // Holding (no suspense yet): soft full ring to show "locked in".
          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = Math.max(2, r * 0.08);
          ctx.arc(px, py, r * 1.14, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Emoji.
        ctx.globalAlpha = alpha;
        ctx.font = `${Math.round(r * 1.05)}px system-ui, "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.emoji, px, py + r * 0.04);

        // Name label under the puck (always visible — "who's who").
        ctx.globalAlpha = alpha;
        ctx.font = `600 ${Math.max(11, Math.round(r * 0.32))}px system-ui, sans-serif`;
        ctx.fillStyle = result && !isWinner ? "rgba(255,255,255,0.6)" : "#fff";
        const label = p.name + (me && p.id === me.id ? " ·" : "");
        ctx.fillText(label, px, py + r * 1.6);

        ctx.restore();
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ---- local hold handling -------------------------------------------------
  const startHold = (e) => {
    if (result) return; // round is over
    if (e.currentTarget.setPointerCapture && e.pointerId != null) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (!holdingRef.current) {
      holdingRef.current = true;
      onReadyChange(true);
      if (navigator.vibrate) navigator.vibrate(15);
    }
  };
  const endHold = () => {
    if (holdingRef.current) {
      holdingRef.current = false;
      onReadyChange(false);
    }
  };

  const isMeWinner = me && result && result.chosenPlayerId === me.id;
  const meReady = me && (ready.readyIds || []).includes(me.id);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Pointer/hold surface + canvas stage */}
      <div
        className="hold-target absolute inset-0"
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onPointerLeave={endHold}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

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
            <p className="text-white/40 text-sm">Everyone hold to choose</p>
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
                className="pointer-events-auto w-full py-4 rounded-2xl bg-white text-black active:bg-white/80 font-bold text-lg transition"
              >
                Play again
              </button>
            ) : (
              <p className="text-center text-white/70">
                Waiting for host to play again…
              </p>
            )}
            <button
              onClick={onLeave}
              className="pointer-events-auto w-full py-2 text-white/50 text-sm"
            >
              Leave
            </button>
          </div>
        ) : (
          <p className="text-center text-white/50 text-sm">
            {meReady ? "Holding — don't let go ✋" : "Press & hold anywhere"}
          </p>
        )}
      </div>
    </div>
  );
}
