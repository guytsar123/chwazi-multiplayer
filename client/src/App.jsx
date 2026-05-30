import { useEffect, useState, useCallback } from "react";
import { socket } from "./socket";
import { useWakeLock } from "./useWakeLock";
import HomeScreen from "./screens/HomeScreen.jsx";
import LobbyScreen from "./screens/LobbyScreen.jsx";
import CountdownScreen from "./screens/CountdownScreen.jsx";
import HoldScreen from "./screens/HoldScreen.jsx";
import ResultScreen from "./screens/ResultScreen.jsx";

export default function App() {
  // screen: "home" | "lobby" | "countdown" | "hold" | "result"
  const [screen, setScreen] = useState("home");
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState("");

  const [roomCode, setRoomCode] = useState("");
  const [me, setMe] = useState(null); // { id, name, emoji, color }
  const [players, setPlayers] = useState([]);
  const [hostId, setHostId] = useState(null);

  const [countdown, setCountdown] = useState(3);
  const [ready, setReady] = useState({ readyCount: 0, totalCount: 0, readyIds: [] });
  const [result, setResult] = useState(null); // { chosenPlayerId, ... }
  const [history, setHistory] = useState([]);

  const isHost = me && hostId && me.id === hostId;
  const sessionActive = ["lobby", "countdown", "hold", "result"].includes(screen);
  useWakeLock(sessionActive);

  // ---- socket lifecycle ----------------------------------------------------
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Our socket id changes on reconnect; keep `me.id` in sync.
      setMe((m) => (m ? { ...m, id: socket.id } : m));
    };
    const onDisconnect = () => setConnected(false);

    const onLobbyUpdate = ({ players, hostId, state }) => {
      setPlayers(players);
      setHostId(hostId);
      // If a round result is showing and host resets remotely, the lobby_reset
      // event handles screen change; here we only sync the roster.
      if (state === "waiting" && screen === "result") {
        // wait for explicit lobby_reset to move screens
      }
    };

    const onRoundStarted = ({ countdown }) => {
      setCountdown(countdown);
      setResult(null);
      setScreen("countdown");
    };
    const onCountdownTick = ({ countdown }) => setCountdown(countdown);
    const onSelectionStarted = ({ totalCount }) => {
      setReady({ readyCount: 0, totalCount, readyIds: [] });
      setScreen("hold");
    };
    const onReadyUpdate = (payload) => setReady(payload);
    const onRoundResult = (payload) => {
      setResult(payload);
      if (payload.history) setHistory(payload.history);
      setScreen("result");
      if (navigator.vibrate) navigator.vibrate([40, 60, 120]);
    };
    const onLobbyReset = () => {
      setResult(null);
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
      socket.off("round_result", onRoundResult);
      socket.off("lobby_reset", onLobbyReset);
      socket.off("host_changed", onHostChanged);
      socket.off("lobby_closed", onLobbyClosed);
    };
  }, [screen]);

  const resetToHome = useCallback(() => {
    setScreen("home");
    setRoomCode("");
    setMe(null);
    setPlayers([]);
    setHostId(null);
    setResult(null);
    setHistory([]);
  }, []);

  // ---- actions -------------------------------------------------------------
  const createLobby = useCallback((hostName) => {
    setError("");
    socket.emit("create_lobby", { hostName }, (res) => {
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

  const joinLobby = useCallback((code, playerName) => {
    setError("");
    socket.emit("join_lobby", { roomCode: code, playerName }, (res) => {
      if (!res?.ok) {
        setError(res?.error || "Could not join lobby");
        return;
      }
      setRoomCode(res.roomCode);
      setMe(res.you);
      setHistory(res.history || []);
      setScreen("lobby");
    });
  }, []);

  const startRound = useCallback(() => socket.emit("start_round"), []);
  const playAgain = useCallback(() => socket.emit("play_again"), []);
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

      {screen === "hold" && (
        <HoldScreen
          me={me}
          players={players}
          ready={ready}
          onReadyChange={setReadyState}
        />
      )}

      {screen === "result" && (
        <ResultScreen
          result={result}
          me={me}
          isHost={isHost}
          history={history}
          onPlayAgain={playAgain}
          onLeave={leaveLobby}
        />
      )}
    </div>
  );
}
