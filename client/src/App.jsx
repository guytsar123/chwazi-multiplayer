import { useEffect, useState, useCallback, useRef } from "react";
import { socket } from "./socket";
import { useWakeLock } from "./useWakeLock";
import HomeScreen from "./screens/HomeScreen.jsx";
import LobbyScreen from "./screens/LobbyScreen.jsx";
import CountdownScreen from "./screens/CountdownScreen.jsx";
import ArenaScreen from "./screens/ArenaScreen.jsx";

export default function App() {
  // screen: "home" | "lobby" | "countdown" | "arena"
  // The arena covers both holding/selecting and the result reveal, so the
  // winner flood animates seamlessly without a screen swap.
  const [screen, setScreen] = useState("home");
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState("");

  const [roomCode, setRoomCode] = useState("");
  const [me, setMe] = useState(null); // { id, name, emoji, color }
  const [players, setPlayers] = useState([]);
  const [hostId, setHostId] = useState(null);

  const [countdown, setCountdown] = useState(3);
  const [ready, setReady] = useState({ readyCount: 0, totalCount: 0, readyIds: [] });
  // suspense: drives the synchronized ring-sweep on every device.
  const [suspense, setSuspense] = useState(null); // { startedAt, durationMs } | null
  const [result, setResult] = useState(null); // { chosenPlayerId, ... } | null
  const [history, setHistory] = useState([]);

  // Live puck positions, kept in a ref (NOT state) so 20Hz network updates never
  // re-render React — the canvas rAF loop reads this directly.
  // posRef.current = Map<playerId, { tx, ty }>  (normalized target positions)
  const posRef = useRef(new Map());

  const isHost = me && hostId && me.id === hostId;
  const sessionActive = ["lobby", "countdown", "arena"].includes(screen);
  useWakeLock(sessionActive);

  // ---- socket lifecycle ----------------------------------------------------
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Our socket id changes on reconnect; keep `me.id` in sync.
      setMe((m) => (m ? { ...m, id: socket.id } : m));
    };
    const onDisconnect = () => setConnected(false);

    const onLobbyUpdate = ({ players, hostId }) => {
      setPlayers(players);
      setHostId(hostId);
      // Seed/refresh target positions for any player we don't track yet, from the
      // server snapshot (handles late-joiners and reconnects).
      const m = posRef.current;
      const live = new Set();
      for (const p of players) {
        live.add(p.id);
        if (!m.has(p.id)) {
          m.set(p.id, { tx: p.x ?? 0.5, ty: p.y ?? 0.5 });
        }
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
      if (id === socket.id) return; // my own echo — I render locally (prediction)
      const m = posRef.current;
      const cur = m.get(id);
      if (cur) {
        cur.tx = x;
        cur.ty = y;
      } else {
        m.set(id, { tx: x, ty: y });
      }
    };
    const onSuspenseStarted = ({ durationMs }) => {
      setSuspense({ startedAt: Date.now(), durationMs });
    };
    const onSuspenseCancelled = () => setSuspense(null);
    const onRoundResult = (payload) => {
      setSuspense(null);
      setResult(payload);
      if (payload.history) setHistory(payload.history);
      setScreen("arena");
      if (navigator.vibrate) navigator.vibrate([40, 60, 160]);
    };
    const onLobbyReset = () => {
      setResult(null);
      setSuspense(null);
      setReady({ readyCount: 0, totalCount: 0, readyIds: [] });
      setScreen("lobby");
    };
    const onHostChanged = ({ hostId }) => setHostId(hostId);
    const onLobbyClosed = ({ reason }) => {
      setError(
        reason === "expired"
          ? "Lobby expired due to inactivity."
          : "The lobby was closed."
      );
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
    };
  }, []);

  const resetToHome = useCallback(() => {
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
    socket.emit("create_lobby", { hostName, emoji, color }, (res) => {
      if (!res?.ok) {
        setError(res?.error || "Could not create lobby");
        return;
      }
      setRoomCode(res.roomCode);
      setMe(res.you);
      setHostId(res.you.id);
      setScreen("lobby");
    });
  }, []);

  const joinLobby = useCallback((code, playerName, emoji, color) => {
    setError("");
    socket.emit(
      "join_lobby",
      { roomCode: code, playerName, emoji, color },
      (res) => {
        if (!res?.ok) {
          setError(res?.error || "Could not join lobby");
          return;
        }
        setRoomCode(res.roomCode);
        setMe(res.you);
        setHistory(res.history || []);
        setScreen("lobby");
      }
    );
  }, []);

  const startRound = useCallback(() => socket.emit("start_round"), []);
  const playAgain = useCallback(() => socket.emit("play_again"), []);
  // Throttled in ArenaScreen; here we just forward to the server.
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
        <HomeScreen
          onCreate={createLobby}
          onJoin={joinLobby}
          error={error}
          connected={connected}
        />
      )}

      {screen === "lobby" && (
        <LobbyScreen
          roomCode={roomCode}
          players={players}
          me={me}
          isHost={isHost}
          history={history}
          onStart={startRound}
          onLeave={leaveLobby}
        />
      )}

      {screen === "countdown" && (
        <CountdownScreen countdown={countdown} me={me} />
      )}

      {screen === "arena" && (
        <ArenaScreen
          me={me}
          players={players}
          ready={ready}
          suspense={suspense}
          result={result}
          isHost={isHost}
          history={history}
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
