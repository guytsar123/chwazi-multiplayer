import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

// Shows the chosen player with a celebratory burst. The result payload comes
// from the server's round_result event. Only the host can start another round.
export default function ResultScreen({
  result,
  me,
  isHost,
  history,
  onPlayAgain,
  onLeave,
}) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (result && !firedRef.current) {
      firedRef.current = true;
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.4 },
        colors: result.chosenColor ? [result.chosenColor] : undefined,
      });
    }
  }, [result]);

  if (!result) return null;

  const isMe = me && result.chosenPlayerId === me.id;

  return (
    <div className="screen items-center justify-center text-center">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm">
        <p className="text-white/50 mb-4">{isMe ? "It's you!" : "Chosen"}</p>

        <div
          className="flex items-center justify-center rounded-full mb-6 animate-pop-in"
          style={{
            width: "12rem",
            height: "12rem",
            backgroundColor: result.chosenColor,
          }}
        >
          <span className="text-7xl">{result.chosenEmoji}</span>
        </div>

        <h1 className="text-4xl font-extrabold mb-2">{result.chosenPlayerName}</h1>

        {history && history.length > 0 && (
          <div className="mt-6 w-full">
            <p className="text-white/40 text-xs mb-2">Recent</p>
            <div className="space-y-1">
              {history.map((h, i) => (
                <div
                  key={`${h.id}-${h.at}`}
                  className="text-sm text-white/60 flex justify-center gap-2"
                >
                  <span>{i === 0 ? "🏆" : "•"}</span>
                  <span>{h.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-full max-w-sm mx-auto space-y-2">
        {isHost ? (
          <button
            onClick={onPlayAgain}
            className="w-full py-4 rounded-2xl bg-red-500 active:bg-red-600 font-bold text-lg transition"
          >
            Play again
          </button>
        ) : (
          <p className="py-4 text-white/50">Waiting for host to play again…</p>
        )}
        <button
          onClick={onLeave}
          className="w-full py-2 text-white/40 text-sm"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
