import { createContext, useContext, useState, useEffect, useCallback } from "react";

// Lightweight i18n. Default language is English; the user can switch to Hebrew,
// Arabic or Russian. Hebrew and Arabic are RTL. The choice is per-device and
// persisted; document lang/dir are kept in sync.

export const LANGS = [
  { id: "en", label: "English" },
  { id: "he", label: "עברית" },
  { id: "ar", label: "العربية" },
  { id: "ru", label: "Русский" },
];
const RTL = new Set(["he", "ar"]);
export const isRTL = (lang) => RTL.has(lang);

const STRINGS = {
  en: {
    subtitle: "Multiplayer random chooser",
    createRoom: "Create room",
    joinRoom: "Join room",
    yourName: "Your name",
    randomColorNote: "You'll get a random color 🎨",
    create: "Create",
    join: "Join",
    back: "Back",
    connecting: "Connecting to server…",
    createFail: "Couldn't create room",
    joinFail: "Couldn't join room",
    reconnecting: "Reconnecting…",
    lobbyExpired: "The room closed due to inactivity.",
    lobbyClosed: "The room was closed.",
    leave: "Leave",
    players_one: "player",
    players_other: "players",
    roomCode: "Room code",
    scanHint: "Scan the QR, or type the 4-digit code",
    modeOne: "One",
    modeMultiple: "Multiple",
    modeGroups: "Teams",
    hintOne: "Pick one winner",
    hintMultiple: "Pick several winners",
    hintGroups: "Split into random teams",
    unitTeams: "teams",
    unitWinners: "win",
    you: "(you)",
    away: "· away",
    host: "host",
    lastChosen: "Last chosen: {x}",
    nTeams: "{n} teams",
    start: "Start",
    needPlayers: "Need 2+ players",
    waitingHost: "Waiting for the host to start…",
    getReady: "Get ready…",
    yourColor: "Your color",
    youWin: "It's you! 🎉",
    chosen: "{name} is chosen",
    multipleChosen: "{names} chosen!",
    teamsResult: "{n} teams!",
    choosing: "Choosing…",
    holding: "{ready} / {total} holding",
    holdHint: "Hold your circle • drag it around",
    playAgain: "Play again",
    waitingPlayAgain: "Waiting for the host to play again…",
    holdingDontLetGo: "Holding — don't let go ✋",
    holdToJoin: "Hold your circle to join in",
    mute: "Mute",
    unmute: "Unmute",
    language: "Language",
  },
  he: {
    subtitle: "בוחר אקראי מרובה משתתפים",
    createRoom: "יצירת חדר",
    joinRoom: "הצטרפות לחדר",
    yourName: "השם שלך",
    randomColorNote: "צבע אקראי ייבחר לך אוטומטית 🎨",
    create: "צור",
    join: "הצטרף",
    back: "חזרה",
    connecting: "מתחבר לשרת…",
    createFail: "לא ניתן ליצור חדר",
    joinFail: "לא ניתן להצטרף לחדר",
    reconnecting: "מתחבר מחדש…",
    lobbyExpired: "החדר נסגר עקב חוסר פעילות.",
    lobbyClosed: "החדר נסגר.",
    leave: "יציאה",
    players_one: "שחקן",
    players_other: "שחקנים",
    roomCode: "קוד חדר",
    scanHint: "סרקו את ה-QR, או הקלידו את קוד 4 הספרות",
    modeOne: "אחד",
    modeMultiple: "כמה",
    modeGroups: "קבוצות",
    hintOne: "בחירת זוכה אחד",
    hintMultiple: "בחירת כמה זוכים",
    hintGroups: "חלוקה לקבוצות אקראיות",
    unitTeams: "קבוצות",
    unitWinners: "זוכים",
    you: "(אתה)",
    away: "· מנותק",
    host: "מארח",
    lastChosen: "נבחר לאחרונה: {x}",
    nTeams: "{n} קבוצות",
    start: "התחל",
    needPlayers: "צריך 2+ שחקנים",
    waitingHost: "ממתינים שהמארח יתחיל…",
    getReady: "להתכונן…",
    yourColor: "הצבע שלך",
    youWin: "זה אתה! 🎉",
    chosen: "{name} נבחר",
    multipleChosen: "{names} נבחרו!",
    teamsResult: "{n} קבוצות!",
    choosing: "בוחר…",
    holding: "{ready} / {total} מחזיקים",
    holdHint: "החזיקו את העיגול • גררו אותו",
    playAgain: "שחק שוב",
    waitingPlayAgain: "ממתינים שהמארח יתחיל סיבוב חדש…",
    holdingDontLetGo: "מחזיק — אל תעזוב ✋",
    holdToJoin: "החזיקו את העיגול כדי להצטרף",
    mute: "השתק",
    unmute: "בטל השתקה",
    language: "שפה",
  },
  ar: {
    subtitle: "أداة اختيار عشوائية لعدة لاعبين",
    createRoom: "إنشاء غرفة",
    joinRoom: "الانضمام إلى غرفة",
    yourName: "اسمك",
    randomColorNote: "سيتم اختيار لون عشوائي لك 🎨",
    create: "إنشاء",
    join: "انضمام",
    back: "رجوع",
    connecting: "جارٍ الاتصال بالخادم…",
    createFail: "تعذّر إنشاء الغرفة",
    joinFail: "تعذّر الانضمام إلى الغرفة",
    reconnecting: "جارٍ إعادة الاتصال…",
    lobbyExpired: "تم إغلاق الغرفة بسبب عدم النشاط.",
    lobbyClosed: "تم إغلاق الغرفة.",
    leave: "خروج",
    players_one: "لاعب",
    players_other: "لاعبون",
    roomCode: "رمز الغرفة",
    scanHint: "امسح رمز QR أو أدخل الرمز المكوّن من 4 أرقام",
    modeOne: "واحد",
    modeMultiple: "عدة",
    modeGroups: "فِرَق",
    hintOne: "اختيار فائز واحد",
    hintMultiple: "اختيار عدة فائزين",
    hintGroups: "تقسيم إلى فِرَق عشوائية",
    unitTeams: "فِرَق",
    unitWinners: "فائز",
    you: "(أنت)",
    away: "· غير متصل",
    host: "المضيف",
    lastChosen: "آخر اختيار: {x}",
    nTeams: "{n} فِرَق",
    start: "ابدأ",
    needPlayers: "مطلوب لاعبان أو أكثر",
    waitingHost: "في انتظار أن يبدأ المضيف…",
    getReady: "استعدوا…",
    yourColor: "لونك",
    youWin: "إنه أنت! 🎉",
    chosen: "تم اختيار {name}",
    multipleChosen: "تم اختيار {names}!",
    teamsResult: "{n} فِرَق!",
    choosing: "جارٍ الاختيار…",
    holding: "{ready} / {total} يضغطون",
    holdHint: "اضغط على دائرتك • اسحبها",
    playAgain: "العب مرة أخرى",
    waitingPlayAgain: "في انتظار أن يبدأ المضيف جولة جديدة…",
    holdingDontLetGo: "اضغط مع الاستمرار — لا تترك ✋",
    holdToJoin: "اضغط على دائرتك للانضمام",
    mute: "كتم",
    unmute: "إلغاء الكتم",
    language: "اللغة",
  },
  ru: {
    subtitle: "Случайный выбор для нескольких игроков",
    createRoom: "Создать комнату",
    joinRoom: "Войти в комнату",
    yourName: "Ваше имя",
    randomColorNote: "Вам выдадут случайный цвет 🎨",
    create: "Создать",
    join: "Войти",
    back: "Назад",
    connecting: "Подключение к серверу…",
    createFail: "Не удалось создать комнату",
    joinFail: "Не удалось войти в комнату",
    reconnecting: "Переподключение…",
    lobbyExpired: "Комната закрыта из-за неактивности.",
    lobbyClosed: "Комната закрыта.",
    leave: "Выйти",
    players_one: "игрок",
    players_other: "игроков",
    roomCode: "Код комнаты",
    scanHint: "Отсканируйте QR или введите 4-значный код",
    modeOne: "Один",
    modeMultiple: "Несколько",
    modeGroups: "Команды",
    hintOne: "Выбрать одного победителя",
    hintMultiple: "Выбрать несколько победителей",
    hintGroups: "Разделить на случайные команды",
    unitTeams: "команд",
    unitWinners: "поб.",
    you: "(вы)",
    away: "· не в сети",
    host: "хост",
    lastChosen: "Последний выбор: {x}",
    nTeams: "{n} команд",
    start: "Старт",
    needPlayers: "Нужно 2+ игрока",
    waitingHost: "Ожидание начала от хоста…",
    getReady: "Приготовьтесь…",
    yourColor: "Ваш цвет",
    youWin: "Это вы! 🎉",
    chosen: "Выбран: {name}",
    multipleChosen: "Выбраны: {names}!",
    teamsResult: "{n} команд!",
    choosing: "Выбираем…",
    holding: "{ready} / {total} держат",
    holdHint: "Держите свой круг • перетаскивайте",
    playAgain: "Ещё раз",
    waitingPlayAgain: "Ожидание новой игры от хоста…",
    holdingDontLetGo: "Держите — не отпускайте ✋",
    holdToJoin: "Держите свой круг, чтобы участвовать",
    mute: "Звук выкл.",
    unmute: "Звук вкл.",
    language: "Язык",
  },
};

function getInitialLang() {
  try {
    const s = localStorage.getItem("chooseme_lang");
    if (s && STRINGS[s]) return s;
  } catch {
    /* ignore */
  }
  return "en";
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(getInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL(lang) ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((l) => {
    if (!STRINGS[l]) return;
    try {
      localStorage.setItem("chooseme_lang", l);
    } catch {
      /* ignore */
    }
    setLangState(l);
  }, []);

  const t = useCallback(
    (key, params) => {
      const dict = STRINGS[lang] || STRINGS.en;
      let s = dict[key] ?? STRINGS.en[key] ?? key;
      if (params) for (const k in params) s = s.split(`{${k}}`).join(params[k]);
      return s;
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t, rtl: isRTL(lang) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
