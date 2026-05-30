import { useState, useEffect } from "react";

export default function HomeScreen({ onCreate, onJoin, error, connected }) {
  const [mode, setMode] = useState(null); // null | "create" | "join"
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  // Pre-fill the room code from a ?room=CODE deep link (QR scan).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) {
      setCode(room.toUpperCase().slice(0, 6));
      setMode("join");
    }
  }, []);

  const canSubmit =
    name.trim().length > 0 &&
    (mode === "create" || (mode === "join" && code.trim().length === 6));

  const submit = () => {
    if (!canSubmit) return;
    if (mode === "create") onCreate(name.trim());
    else onJoin(code.trim().toUpperCase(), name.trim());
  };

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
          <div className="w-full space-y-3">
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
                maxLength={6}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                }
                placeholder="ROOM CODE"
                className="w-full py-4 px-4 rounded-2xl bg-white/10 text-center text-2xl font-mono tracking-[0.3em] outline-none focus:ring-2 ring-red-500"
              />
            )}

            <button
              onClick={submit}
              disabled={!canSubmit || !connected}
              className="w-full py-4 rounded-2xl bg-red-500 active:bg-red-600 disabled:opacity-40 font-bold text-lg transition"
            >
              {mode === "create" ? "Create" : "Join"}
            </button>
            <button
              onClick={() => {
                setMode(null);
                setError;
              }}
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
