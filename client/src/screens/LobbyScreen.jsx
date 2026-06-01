import { QRCodeSVG } from "qrcode.react";

// Lobby: room code + QR to join, the player roster, the game-mode picker (host),
// and the Start button.
export default function LobbyScreen({
  roomCode,
  players,
  me,
  isHost,
  history,
  config,
  onSetMode,
  onStart,
  onLeave,
}) {
  const joinUrl = `${window.location.origin}/?room=${roomCode}`;
  const canStart = players.length >= 2;
  const mode = config?.mode || "one";
  const count = config?.count || 1;

  const MODES = [
    { id: "one", label: "אחד", hint: "בחירת זוכה אחד" },
    { id: "multiple", label: "כמה", hint: "בחירת כמה זוכים" },
    { id: "groups", label: "קבוצות", hint: "חלוקה לקבוצות אקראיות" },
  ];

  const setMode = (m) => {
    if (!isHost) return;
    const def = m === "groups" ? 2 : m === "multiple" ? 2 : 1;
    onSetMode(m, def);
  };
  const bump = (delta) => {
    if (!isHost) return;
    const lo = mode === "groups" ? 2 : 1;
    const next = Math.min(8, Math.max(lo, count + delta));
    onSetMode(mode, next);
  };

  return (
    <div className="screen">
      <div className="flex items-center justify-between">
        <button onClick={onLeave} className="text-white/40 text-sm py-2">
          → יציאה
        </button>
        <span className="text-white/40 text-sm">
          {players.length} {players.length === 1 ? "שחקן" : "שחקנים"}
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mx-auto">
        <p className="text-white/50 text-sm mb-1">קוד חדר</p>
        <div className="text-5xl font-mono font-extrabold tracking-[0.2em] mb-4">
          {roomCode}
        </div>

        <div className="bg-white p-3 rounded-2xl mb-3">
          <QRCodeSVG value={joinUrl} size={150} />
        </div>
        <p className="text-white/40 text-xs mb-5 text-center">
          סרקו את ה-QR, או הקלידו את קוד 4 הספרות
        </p>

        {/* Mode picker */}
        <div className="w-full mb-4">
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                disabled={!isHost}
                className={`py-2.5 rounded-xl text-sm font-semibold transition ${
                  mode === m.id
                    ? "bg-red-500 text-white"
                    : "bg-white/5 text-white/70 active:bg-white/15"
                } ${!isHost ? "opacity-70" : ""}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between mt-2 h-7">
            <span className="text-white/40 text-xs">
              {MODES.find((m) => m.id === mode)?.hint}
            </span>
            {mode !== "one" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => bump(-1)}
                  disabled={!isHost}
                  className="w-7 h-7 rounded-lg bg-white/10 active:bg-white/20 font-bold disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-14 text-center font-bold">
                  {count} {mode === "groups" ? "קבוצות" : "זוכים"}
                </span>
                <button
                  onClick={() => bump(1)}
                  disabled={!isHost}
                  className="w-7 h-7 rounded-lg bg-white/10 active:bg-white/20 font-bold disabled:opacity-40"
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="w-full grid grid-cols-1 gap-2">
          {players.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3"
              style={{ borderInlineStart: `4px solid ${p.color}`, opacity: p.connected === false ? 0.45 : 1 }}
            >
              <span
                className="w-6 h-6 rounded-full shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="font-medium flex-1 truncate">
                {p.name}
                {me && p.id === me.id && <span className="text-white/40"> (אתה)</span>}
                {p.connected === false && <span className="text-white/30 text-xs"> · מנותק</span>}
              </span>
              {p.isHost && (
                <span className="text-xs bg-white/10 rounded-full px-2 py-0.5">מארח</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {history && history.length > 0 && (
        <div className="w-full max-w-sm mx-auto mb-4 text-center text-white/40 text-xs">
          נבחר לאחרונה: {history[0].name}
        </div>
      )}

      {isHost ? (
        <button
          onClick={onStart}
          disabled={!canStart}
          className="w-full max-w-sm mx-auto py-4 rounded-2xl bg-red-500 active:bg-red-600 disabled:opacity-40 font-bold text-lg transition"
        >
          {canStart ? "התחל" : "צריך 2+ שחקנים"}
        </button>
      ) : (
        <p className="w-full max-w-sm mx-auto py-4 text-center text-white/50">
          ממתינים שהמארח יתחיל…
        </p>
      )}
    </div>
  );
}
