import { useEffect, useState, useCallback, useRef } from "react";
import { socket, getPlayerId, syncClock } from "./socket";
import { useWakeLock } from "./useWakeLock";
import HomeScreen from "./screens/HomeScreen.jsx";
import LobbyScreen from "./screens/LobbyScreen.jsx";
import CountdownScreen from "./screens/CountdownScreen.jsx";
import ArenaScreen from "./screens/ArenaScreen.jsx";

const PLAYER_ID = getPlayerId();

export default function App() {
  // screen: "home" | "lobby" | "countdown" | "arena"
  const [screen, setScreen] = useState("home");
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState("");

  const [roomCode, setRoomCode] = useState("");
  const [me, setMe] = useState(null); // { id, name, emoji, color }
  const [players, setPlayers] = useState([]);
  const [hostId, setHostId] = useState(null);
  const [config, setConfig] = useState({ mode: "one", count: 1 });

  const [countdown, setCountdown] = useState(3);
  const [ready, setReady] = useState({ readyCount: 0, totalCount: 0, readyIds: [] });
  const [suspense, setSuspense] = useState(null); // { startAt, durationMs } (server time)
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  // Live puck positions (normalized targets), in a ref so 20Hz updates never
  // re-render React — the canvas rAF loop reads this directly. Keyed by playerId.
  const posRef = useRef(new Map());

  // Mirror room/me for the reconnect handler (avoids stale closures).
  const sessionRef = useRef({ roomCode: "", joined: false });

  const isHost = me && hostId && me.id === hostId;
  const sessionActive = ["lobby", "countdown", "arena"].includes(screen);
  useWakeLock(sessionActive);

  // ---- apply a full server snapshot (join / rejoin / late-join) -------------
  const applySnapshot = useCallback((snap) => {
    setRoomCode(snap.roomCode);
    setMe(snap.you);
    setHostId(snap.hostId);
    setConfig({ mode: snap.mode, count: snap.count });
    setPlayers(snap.players);
    setHistory(snap.history || []);
    sessionRef.current = { roomCode: snap.roomCode, joined: true };

    // Seed positions.
    const m = posRef.current;
    m.clear();
    for (const p of snap.players) m.set(p.id, { tx: p.x ?? 0.5, ty: p.y ?? 0.5 });

    // Resume the correct screen for the live phase.
    if (snap.state === "countdown") setScreen("countdown");
    else if (snap.state === "selecting" || snap.state === "result") {
      setResult(snap.state === "result" ? snap.result : null);
      setScreen("arena");
    } else setScreen("lobby");
  }, []);

  // ---- socket lifecycle ----------------------------------------------------
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      syncClock();
      // Reconnect/refresh -> rebind to our existing slot.
      const s = sessionRef.current;
      if (s.joined && s.roomCode) {
        socket.emit("rejoin", { playerId: PLAYER_ID, roomCode: s.roomCode }, (res) => {
          if (res?.ok) applySnapshot(res.snapshot);
        });
      }
    };
    const onDisconnect = () => setConnected(false);

    const onLobbyUpdate = ({ players, hostId, mode, count }) => {
      setPlayers(players);
      setHostId(hostId);
      if (mode) setConfig({ mode, count });
      const m = posRef.current;
      const live = new Set();
      for (const p of players) {
        live.add(p.id);
        if (!m.has(p.id)) m.set(p.id, { tx: p.x ?? 0.5, ty: p.y ?? 0.5 });
      }
      for (const id of [...m.keys()]) if (!live.has(id)) m.delete(id);
    };

    const onRoundStarted = ({ countdown }) => {
      setResult(null);
      setSuspense(null);
      setReady({ readyCount: 0, totalCount: 0, readyIds: [] });
      setCountdown(countdown);
      setScreen("countdown");
    };
    const onCountdownTick = ({ countdown }) => setCountdown(countdown);
    const onSelectionStarted = ({ totalCount }) => {
      setReady({ readyCount: 0, totalCount, readyIds: [] });
      setResult(null);
      setSuspense(null);
      setScreen("arena");
    };
    const onReadyUpdate = (payload) => setReady(payload);
    const onPlayerMoved = ({ id, x, y }) => {
      if (id === PLAYER_ID) return; // my own echo — I render locally (prediction)
      const m = posRef.current;
      const cur = m.get(id);
      if (cur) { cur.tx = x; cur.ty = y; }
      else m.set(id, { tx: x, ty: y });
    };
    const onSuspenseStarted = ({ startAt, durationMs }) =>
      setSuspense({ startAt, durationMs });
    const onSuspenseCancelled = () => setSuspense(null);
    const onRoundResult = (payload) => {
      setSuspense(null);
      setResult(payload);
      if (payload.history) setHistory(payload.history);
      setScreen("arena");
    };
    const onLobbyReset = () => {
      setResult(null);
      setSuspense(null);
      setReady({ readyCount: 0, totalCount: 0, readyIds: [] });
      setScreen("lobby");
    };
    const onHostChanged = ({ hostId }) => setHostId(hostId);
    const onLobbyClosed = ({ reason }) => {
      setError(reason === "expired" ? "Lobby expired due to inactivity." : "The lobby was closed.");
      resetToHome();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("lobby_update", onLobbyUpdate);
    socket.on("round_started", onRoundStarted);
    socket.on("countdown_tick", onCountdownTick);
    socket.on("selection_started", onSelectionStarted);
    socket.on("ready_update", onReadyUpdate);
    socket.on("player_moved", onPlayerMoved);
    socket.on("suspense_started", onSuspenseStarted);
    socket.on("suspense_cancelled", onSuspenseCancelled);
    socket.on("round_result", onRoundResult);
    socket.on("lobby_reset", onLobbyReset);
    socket.on("host_changed", onHostChanged);
    socket.on("lobby_closed", onLobbyClosed);

    if (socket.connected) syncClock();

    // Tab returns to foreground -> re-sync clock + re-pull fresh state.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!socket.connected) return;
      syncClock();
      const s = sessionRef.current;
      if (s.joined && s.roomCode) {
        socket.emit("rejoin", { playerId: PLAYER_ID, roomCode: s.roomCode }, (res) => {
          if (res?.ok) applySnapshot(res.snapshot);
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("lobby_update", onLobbyUpdate);
      socket.off("round_started", onRoundStarted);
      socket.off("countdown_tick", onCountdownTick);
      socket.off("selection_started", onSelectionStarted);
      socket.off("ready_update", onReadyUpdate);
      socket.off("player_moved", onPlayerMoved);
      socket.off("suspense_started", onSuspenseStarted);
      socket.off("suspense_cancelled", onSuspenseCancelled);
      socket.off("round_result", onRoundResult);
      socket.off("lobby_reset", onLobbyReset);
      socket.off("host_changed", onHostChanged);
      socket.off("lobby_closed", onLobbyClosed);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applySnapshot]);

  const resetToHome = useCallback(() => {
    sessionRef.current = { roomCode: "", joined: false };
    setScreen("home");
    setRoomCode("");
    setMe(null);
    setPlayers([]);
    setHostId(null);
    setResult(null);
    setSuspense(null);
    setHistory([]);
  }, []);

  // ---- actions -------------------------------------------------------------
  const createLobby = useCallback((hostName, emoji, color) => {
    setError("");
    socket.emit(
      "create_lobby",
      { playerId: PLAYER_ID, hostName, emoji, color, mode: "one", count: 1 },
      (res) => {
        if (!res?.ok) return setError(res?.error || "Could not create lobby");
        applySnapshot(res.snapshot);
      }
    );
  }, [applySnapshot]);

  const joinLobby = useCallback((code, playerName, emoji, color) => {
    setError("");
    socket.emit(
      "join_lobby",
      { playerId: PLAYER_ID, roomCode: code, playerName, emoji, color },
      (res) => {
        if (!res?.ok) return setError(res?.error || "Could not join lobby");
        applySnapshot(res.snapshot);
      }
    );
  }, [applySnapshot]);

  const setMode = useCallback((mode, count) => socket.emit("set_mode", { mode, count }), []);
  const startRound = useCallback(() => socket.emit("start_round"), []);
  const playAgain = useCallback(() => socket.emit("play_again"), []);
  const sendMove = useCallback((x, y) => socket.emit("move", { x, y }), []);
  const setReadyState = useCallback((isReady) => {
    socket.emit(isReady ? "player_ready" : "player_unready");
  }, []);
  const leaveLobby = useCallback(() => {
    socket.emit("leave_lobby");
    resetToHome();
  }, [resetToHome]);

  // ---- render --------------------------------------------------------------
  return (
    <div className="no-select h-full">
      {!connected && screen !== "home" && (
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-600 text-center text-sm py-1">
          Reconnecting…
        </div>
      )}

      {screen === "home" && (
        <HomeScreen onCreate={createLobby} onJoin={joinLobby} error={error} connected={connected} />
      )}

      {screen === "lobby" && (
        <LobbyScreen
          roomCode={roomCode}
          players={players}
          me={me}
          isHost={isHost}
          history={history}
          config={config}
          onSetMode={setMode}
          onStart={startRound}
          onLeave={leaveLobby}
        />
      )}

      {screen === "countdown" && <CountdownScreen countdown={countdown} me={me} />}

      {screen === "arena" && (
        <ArenaScreen
          me={me}
          players={players}
          ready={ready}
          suspense={suspense}
          result={result}
          isHost={isHost}
          history={history}
          config={config}
          positions={posRef}
          onReadyChange={setReadyState}
          onMove={sendMove}
          onPlayAgain={playAgain}
          onLeave={leaveLobby}
        />
      )}
    </div>
  );
}
