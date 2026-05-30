import { useRef } from "react";

// The "place your finger" screen. Unlike the original single-screen Chwazi, each
// player holds a finger on THEIR OWN device; pressing reports player_ready to the
// server and releasing reports player_unready. The server resolves the winner
// once everyone is holding (see server/index.js). We capture the pointer so the
// hold survives small finger slides.
//
// Every player is shown with their name + emoji + color so it's always clear
// "who's who" during the round, and whose finger is currently down.
export default function HoldScreen({ me, players, ready, onReadyChange }) {
  const holdingRef = useRef(false);

  const start = (e) => {
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
      if (navigator.vibrate) navigator.vibrate(20);
    }
  };

  const stop = () => {
    if (holdingRef.current) {
      holdingRef.current = false;
      onReadyChange(false);
    }
  };

  const readyIds = ready.readyIds || [];
  const meReady = me && readyIds.includes(me.id);
  const myColor = me?.color || "#ef4444";

  return (
    <div className="screen items-center justify-center">
      <div className="absolute top-0 inset-x-0 pt-[max(1rem,env(safe-area-inset-top))] text-center">
        <p className="text-white/70 text-lg font-medium">
          {ready.readyCount} / {ready.totalCount} holding
        </p>
        <p className="text-white/40 text-sm">Everyone hold to choose</p>
      </div>

      <button
        onPointerDown={start}
        onPointerUp={stop}
        onPointerCancel={stop}
        onPointerLeave={stop}
        className="hold-target flex-1 w-full flex flex-col items-center justify-center gap-4 select-none"
      >
        <div
          className={`flex items-center justify-center rounded-full transition-transform ${
            meReady ? "animate-pulse-ring scale-100" : "scale-90 opacity-80"
          }`}
          style={{
            width: "14rem",
            height: "14rem",
            backgroundColor: meReady ? myColor : "rgba(255,255,255,0.06)",
            border: `4px solid ${myColor}`,
          }}
        >
          <span className="text-6xl">{me?.emoji || "👆"}</span>
        </div>
        {/* Your own identity, clearly labelled */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-lg" style={{ color: myColor }}>
            {me?.name || "You"}
          </span>
          <span className="text-white/40 text-sm">(you)</span>
        </div>
      </button>

      {/* Everyone in the room: name + emoji + color + holding state */}
      <div className="absolute bottom-0 inset-x-0 pb-[max(1rem,env(safe-area-inset-bottom))] px-3">
        <div className="flex justify-center gap-2 flex-wrap">
          {players.map((p) => {
            const isReady = readyIds.includes(p.id);
            const isMe = me && p.id === me.id;
            return (
              <div
                key={p.id}
                className="flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 transition"
                style={{
                  backgroundColor: isReady
                    ? "rgba(255,255,255,0.08)"
                    : "transparent",
                  minWidth: "3.5rem",
                }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-lg transition"
                  style={{
                    backgroundColor: isReady ? p.color : "transparent",
                    border: `2px solid ${p.color}`,
                    opacity: isReady ? 1 : 0.45,
                  }}
                >
                  {p.emoji}
                </div>
                <span
                  className="text-[11px] leading-none max-w-[4.5rem] truncate"
                  style={{
                    color: isReady ? p.color : "rgba(255,255,255,0.5)",
                  }}
                >
                  {p.name}
                  {isMe ? " ·" : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
