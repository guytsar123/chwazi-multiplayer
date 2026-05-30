import { QRCodeSVG } from "qrcode.react";

// Lobby: shows the room code + QR for others to join, the player roster, and
// (for the host) the Start button. Mirrors the server's lobby_update payload.
export default function LobbyScreen({
  roomCode,
  players,
  me,
  isHost,
  history,
  onStart,
  onLeave,
}) {
  const joinUrl = `${window.location.origin}/?room=${roomCode}`;
  const canStart = players.length >= 2;

  return (
    <div className="screen">
      <div className="flex items-center justify-between">
        <button onClick={onLeave} className="text-white/40 text-sm py-2">
          ← Leave
        </button>
        <span className="text-white/40 text-sm">
          {players.length} {players.length === 1 ? "player" : "players"}
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto">
        <p className="text-white/50 text-sm mb-1">Room code</p>
        <div className="text-5xl font-mono font-extrabold tracking-[0.2em] mb-4">
          {roomCode}
        </div>

        <div className="bg-white p-3 rounded-2xl mb-6">
          <QRCodeSVG value={joinUrl} size={160} />
        </div>
        <p className="text-white/40 text-xs mb-8 text-center">
          Scan to join, or enter the code on chwazi
        </p>

        <div className="w-full grid grid-cols-1 gap-2">
          {players.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3"
              style={{ borderLeft: `4px solid ${p.color}` }}
            >
              <span className="text-2xl">{p.emoji}</span>
              <span className="font-medium flex-1 truncate">
                {p.name}
                {me && p.id === me.id && (
                  <span className="text-white/40"> (you)</span>
                )}
              </span>
              {p.isHost && (
                <span className="text-xs bg-white/10 rounded-full px-2 py-0.5">
                  host
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {history && history.length > 0 && (
        <div className="w-full max-w-sm mx-auto mb-4 text-center text-white/40 text-xs">
          Last chosen: {history[0].name}
        </div>
      )}

      {isHost ? (
        <button
          onClick={onStart}
          disabled={!canStart}
          className="w-full max-w-sm mx-auto py-4 rounded-2xl bg-red-500 active:bg-red-600 disabled:opacity-40 font-bold text-lg transition"
        >
          {canStart ? "Start" : "Need 2+ players"}
        </button>
      ) : (
        <p className="w-full max-w-sm mx-auto py-4 text-center text-white/50">
          Waiting for the host to start…
        </p>
      )}
    </div>
  );
}
