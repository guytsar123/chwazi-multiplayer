import { useState, useEffect } from "react";
import { useI18n, LANGS } from "../i18n.jsx";

// The server assigns every player a random, unique color automatically — there
// is no avatar or color to choose. The home screen collects a name (and a room
// code when joining), and lets you pick the language.
export default function HomeScreen({ onCreate, onJoin, error, connected }) {
  const { t, lang, setLang, rtl } = useI18n();
  const [mode, setMode] = useState(null); // null | "create" | "join"
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

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
    if (mode === "create") onCreate(name.trim());
    else onJoin(code.trim(), name.trim());
  };

  return (
    <div className="screen items-center justify-center text-center">
      {/* Language switcher */}
      <div className="w-full flex justify-center gap-1.5 flex-wrap">
        {LANGS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLang(l.id)}
            className={`px-3 py-1.5 rounded-full text-sm transition ${
              lang === l.id
                ? "bg-white/20 text-white font-semibold"
                : "bg-white/5 text-white/60 active:bg-white/15"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm">
        <div className="text-7xl mb-2 animate-float">👆</div>
        <h1 className="text-4xl font-extrabold tracking-tight">choose-me</h1>
        <p className="text-white/50 mb-8">{t("subtitle")}</p>

        {!mode && (
          <div className="w-full space-y-3">
            <button
              onClick={() => setMode("create")}
              className="w-full py-4 rounded-2xl bg-red-500 active:bg-red-600 font-bold text-lg transition"
            >
              {t("createRoom")}
            </button>
            <button
              onClick={() => setMode("join")}
              className="w-full py-4 rounded-2xl bg-white/10 active:bg-white/20 font-bold text-lg transition"
            >
              {t("joinRoom")}
            </button>
          </div>
        )}

        {mode && (
          <div className="w-full space-y-4">
            <input
              autoFocus
              value={name}
              maxLength={16}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("yourName")}
              className="w-full py-4 px-4 rounded-2xl bg-white/10 text-center text-lg outline-none focus:ring-2 ring-red-500"
            />

            {mode === "join" && (
              <input
                value={code}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="0000"
                className="w-full py-4 px-4 rounded-2xl bg-white/10 text-center text-3xl font-mono tracking-[0.4em] outline-none focus:ring-2 ring-red-500"
              />
            )}

            <p className="text-white/40 text-xs">{t("randomColorNote")}</p>

            <button
              onClick={submit}
              disabled={!canSubmit || !connected}
              className="w-full py-4 rounded-2xl bg-red-500 active:bg-red-600 disabled:opacity-40 font-bold text-lg transition"
            >
              {mode === "create" ? t("create") : t("join")}
            </button>
            <button
              onClick={() => setMode(null)}
              className="w-full py-2 text-white/40 text-sm"
            >
              {rtl ? "→" : "←"} {t("back")}
            </button>
          </div>
        )}

        {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
        {!connected && <p className="mt-4 text-amber-400 text-sm">{t("connecting")}</p>}
      </div>
    </div>
  );
}
