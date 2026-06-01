// Full-screen 3…2…1 countdown shown to everyone in sync (driven by the server's
// countdown_tick events). `countdown` re-mounts the number so the bounce
// animation replays on each tick. We also show the player's own identity badge
// so each person knows which color is theirs before the round starts.
import { useI18n } from "../i18n.jsx";

export default function CountdownScreen({ countdown, me }) {
  const { t } = useI18n();
  return (
    <div className="screen items-center justify-center">
      <div className="flex-1 flex flex-col items-center justify-center">
        <p className="text-white/50 mb-4">{t("getReady")}</p>
        <div
          key={countdown}
          className="text-[10rem] leading-none font-extrabold animate-count-bounce"
        >
          {countdown}
        </div>
      </div>

      {me && (
        <div className="pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-2">
          <span className="text-white/40 text-xs">{t("yourColor")}</span>
          <div className="flex items-center gap-2">
            <span
              className="w-9 h-9 rounded-full"
              style={{
                backgroundColor: me.color,
                boxShadow: "0 0 0 3px rgba(255,255,255,0.18)",
              }}
            />
            <span className="font-medium" style={{ color: me.color }}>
              {me.name}
            </span>
            <span className="text-white/40 text-sm">{t("you")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
