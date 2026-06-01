import { useState, useEffect } from "react";

// Appearance options. The server accepts any #rrggbb and any short emoji, and
// auto-assigns a unique one if we send nothing — so "🎲 auto" just sends undefined.
const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
];
const EMOJIS = [
  "🦊", "🐼", "🐸", "🦄", "🐙", "🦁", "🐵", "🐯", "🐧", "🦉",
  "🐝", "🦋", "🐢", "🐶", "🐱", "🐰", "🐨", "🐮", "🐷", "🐔",
  "🦖", "🐳", "⭐", "🔥", "🍀", "🌈", "👾", "🚀", "⚡", "🎯",
];

export default function HomeScreen({ onCreate, onJoin, error, connected }) {
  const [mode, setMode] = useState(null); // null | "create" | "join"
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  // Appearance: null = auto (🎲). Otherwise an explicit choice.
  const [emoji, setEmoji] = useState(null);
  const [color, setColor] = useState(null);

  // Pre-fill the room code from a ?room=CODE deep link (QR scan).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) {
      setCode(room.replace(/\D/g, "").slice(0, 4));
      setMode("join");
    }
  }, []);

  const canSubmit =
    name.trim().length > 0 &&
    (mode === "create" || (mode === "join" && code.trim().length === 4));

  const submit = () => {
    if (!canSubmit) return;
    // emoji/color may be null → server auto-assigns.
    if (mode === "create") onCreate(name.trim(), emoji, color);
    else onJoin(code.trim(), name.trim(), emoji, color);
  };

  const previewColor = color || "#3b82f6";
  const previewEmoji = emoji || "🎲";

  return (
    <div className="screen items-center justify-center text-center">
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm">
        <div className="text-7xl mb-2 animate-float">👆</div>
        <h1 className="text-4xl font-extrabold tracking-tight">Chwazi</h1>
        <p className="text-white/50 mb-8">Multiplayer Finger Chooser</p>

        {!mode && (
          <div className="w-full space-y-3">
            <button
              onClick={() => setMode("create")}
              className="w-full py-4 rounded-2xl bg-red-500 active:bg-red-600 font-bold text-lg transition"
            >
              Create Lobby
            </button>
            <button
              onClick={() => setMode("join")}
              className="w-full py-4 rounded-2xl bg-white/10 active:bg-white/20 font-bold text-lg transition"
            >
              Join Lobby
            </button>
          </div>
        )}

        {mode && (
          <div className="w-full space-y-4">
            {/* Live preview of your puck */}
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
                style={{
                  backgroundColor: previewColor,
                  boxShadow: "0 0 0 4px rgba(255,255,255,0.15)",
                }}
              >
                {previewEmoji}
              </div>
              {!emoji && !color && (
                <span className="text-white/40 text-xs">
                  Auto — or pick your look below
                </span>
              )}
            </div>

            <input
              autoFocus
              value={name}
              maxLength={16}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full py-4 px-4 rounded-2xl bg-white/10 text-center text-lg outline-none focus:ring-2 ring-red-500"
            />

            {mode === "join" && (
              <input
                value={code}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="0000"
                className="w-full py-4 px-4 rounded-2xl bg-white/10 text-center text-3xl font-mono tracking-[0.4em] outline-none focus:ring-2 ring-red-500"
              />
            )}

            {/* Emoji picker */}
            <div className="text-left">
              <div className="flex items-center justify-between mb-1">
                <span className="text-white/50 text-xs">Avatar</span>
                <button
                  onClick={() => setEmoji(null)}
                  className="text-white/40 text-xs active:text-white/70"
                >
                  🎲 auto
                </button>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setEmoji(e)}
                    className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl transition ${
                      emoji === e
                        ? "bg-white/25 ring-2 ring-white"
                        : "bg-white/5 active:bg-white/15"
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Color picker */}
            <div className="text-left">
              <div className="flex items-center justify-between mb-1">
                <span className="text-white/50 text-xs">Color</span>
                <button
                  onClick={() => setColor(null)}
                  className="text-white/40 text-xs active:text-white/70"
                >
                  🎲 auto
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full transition ${
                      color === c ? "ring-2 ring-white ring-offset-2 ring-offset-[#0f0f17]" : ""
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={submit}
              disabled={!canSubmit || !connected}
              className="w-full py-4 rounded-2xl bg-red-500 active:bg-red-600 disabled:opacity-40 font-bold text-lg transition"
            >
              {mode === "create" ? "Create" : "Join"}
            </button>
            <button
              onClick={() => setMode(null)}
              className="w-full py-2 text-white/40 text-sm"
            >
              ← Back
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
        {!connected && (
          <p className="mt-4 text-amber-400 text-sm">Connecting to server…</p>
        )}
      </div>
    </div>
  );
}
