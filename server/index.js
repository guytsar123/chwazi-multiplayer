import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { randomInt } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Tunable timing / rules
// ---------------------------------------------------------------------------
const COUNTDOWN_SECONDS = 3; // 3...2...1...GO
const SELECT_TIMEOUT_MS = 15000; // max wait for everyone to hold
const ALL_READY_DELAY_MS = 2200; // suspense duration: the synchronized ring sweep
const LOBBY_TTL_MS = 30 * 60 * 1000; // 30 min of inactivity -> cleanup
const MIN_PLAYERS = 2;
const MAX_HISTORY = 5;

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ---------------------------------------------------------------------------
// In-memory lobby store
// ---------------------------------------------------------------------------
/**
 * lobby = {
 *   roomCode, hostId,
 *   players: Map<socketId, { id, name, emoji, color }>,
 *   ready: Set<socketId>,
 *   state: "waiting" | "countdown" | "selecting" | "result",
 *   history: [{ id, name, at }],
 *   timers: { countdown, selectTimeout, allReady },
 *   lastActivity: number,
 * }
 */
const lobbies = new Map();

const CODE_CHARS = "0123456789"; // digits only — easier to type/share
const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
];
const EMOJIS = ["🦊", "🐼", "🐸", "🦄", "🐙", "🦁", "🐵", "🐯", "🐧", "🦉", "🐝", "🦋"];

function genCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (lobbies.has(code));
  return code;
}

function pickColor(lobby) {
  const used = new Set([...lobby.players.values()].map((p) => p.color));
  const free = COLORS.filter((c) => !used.has(c));
  const pool = free.length ? free : COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickEmoji(lobby) {
  const used = new Set([...lobby.players.values()].map((p) => p.emoji));
  const free = EMOJIS.filter((e) => !used.has(e));
  const pool = free.length ? free : EMOJIS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Players may pick their own appearance on the home screen; validate the choice
// against our known sets and fall back to an auto-assigned one. Color may be any
// hex the client offers from its palette; we accept a simple #rrggbb.
function chooseColor(lobby, wanted) {
  if (typeof wanted === "string" && /^#[0-9a-fA-F]{6}$/.test(wanted)) {
    return wanted;
  }
  return pickColor(lobby);
}

function chooseEmoji(lobby, wanted) {
  if (typeof wanted === "string" && wanted.length > 0 && wanted.length <= 8) {
    return wanted;
  }
  return pickEmoji(lobby);
}

function clearTimers(lobby) {
  if (!lobby.timers) return;
  for (const key of Object.keys(lobby.timers)) {
    if (lobby.timers[key]) {
      clearTimeout(lobby.timers[key]);
      clearInterval(lobby.timers[key]);
      lobby.timers[key] = null;
    }
  }
}

function publicPlayers(lobby) {
  return [...lobby.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    isHost: p.id === lobby.hostId,
    // Last known normalized position (0..1) so late-joiners/repaints are correct.
    x: p.x ?? 0.5,
    y: p.y ?? 0.5,
  }));
}

const clamp01 = (v) =>
  typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : null;

// Spread newly-joined players around a circle (normalized) so they don't stack.
function spawnPosition(lobby) {
  const i = lobby.players.size; // index of the player about to be added
  const total = i + 1;
  const ang = -Math.PI / 2 + (i / Math.max(total, 1)) * Math.PI * 2;
  const r = total === 1 ? 0 : 0.3;
  return { x: 0.5 + Math.cos(ang) * r, y: 0.5 + Math.sin(ang) * r };
}

function broadcastPlayers(lobby) {
  io.to(lobby.roomCode).emit("lobby_update", {
    players: publicPlayers(lobby),
    hostId: lobby.hostId,
    state: lobby.state,
  });
}

function touch(lobby) {
  lobby.lastActivity = Date.now();
}

function destroyLobby(lobby, reason) {
  clearTimers(lobby);
  io.to(lobby.roomCode).emit("lobby_closed", { reason });
  lobbies.delete(lobby.roomCode);
}

// ---------------------------------------------------------------------------
// Round logic
// ---------------------------------------------------------------------------
function startRound(lobby) {
  if (lobby.players.size < MIN_PLAYERS) return;
  clearTimers(lobby);
  lobby.ready = new Set();
  lobby.state = "countdown";
  touch(lobby);

  let n = COUNTDOWN_SECONDS;
  io.to(lobby.roomCode).emit("round_started", { countdown: n });

  lobby.timers.countdown = setInterval(() => {
    n -= 1;
    if (n > 0) {
      io.to(lobby.roomCode).emit("countdown_tick", { countdown: n });
    } else {
      clearInterval(lobby.timers.countdown);
      lobby.timers.countdown = null;
      beginSelecting(lobby);
    }
  }, 1000);
}

function beginSelecting(lobby) {
  lobby.state = "selecting";
  lobby.ready = new Set();
  touch(lobby);
  io.to(lobby.roomCode).emit("selection_started", {
    totalCount: lobby.players.size,
    timeoutMs: SELECT_TIMEOUT_MS,
  });

  // Hard timeout: if not everyone holds in time, choose from whoever is ready.
  lobby.timers.selectTimeout = setTimeout(() => {
    resolveRound(lobby);
  }, SELECT_TIMEOUT_MS);
}

function onPlayerReady(lobby, socketId) {
  if (lobby.state !== "selecting") return;
  if (!lobby.players.has(socketId)) return;
  lobby.ready.add(socketId);
  touch(lobby);
  emitReadyCount(lobby);
  maybeResolve(lobby);
}

function onPlayerUnready(lobby, socketId) {
  if (lobby.state !== "selecting") return;
  lobby.ready.delete(socketId);
  touch(lobby);
  emitReadyCount(lobby);
  // Cancel the suspense delay if someone let go before it fired.
  if (lobby.timers.allReady) {
    clearTimeout(lobby.timers.allReady);
    lobby.timers.allReady = null;
    io.to(lobby.roomCode).emit("suspense_cancelled", {});
  }
}

function emitReadyCount(lobby) {
  io.to(lobby.roomCode).emit("ready_update", {
    readyCount: lobby.ready.size,
    totalCount: lobby.players.size,
    readyIds: [...lobby.ready],
  });
}

function maybeResolve(lobby) {
  if (lobby.state !== "selecting") return;
  const everyone =
    lobby.players.size > 0 && lobby.ready.size >= lobby.players.size;
  if (everyone && !lobby.timers.allReady) {
    // Everybody is holding — kick off the synchronized suspense sweep on every
    // device, then choose when it completes. We send the duration so all clients
    // animate the ring-fill in lockstep and reveal at the same moment.
    io.to(lobby.roomCode).emit("suspense_started", {
      durationMs: ALL_READY_DELAY_MS,
    });
    lobby.timers.allReady = setTimeout(() => {
      resolveRound(lobby);
    }, ALL_READY_DELAY_MS);
  }
}

function resolveRound(lobby) {
  if (lobby.state !== "selecting") return;
  clearTimers(lobby);

  // Choose from players who are currently holding; fall back to all players.
  let pool = [...lobby.ready].filter((id) => lobby.players.has(id));
  if (pool.length === 0) pool = [...lobby.players.keys()];
  if (pool.length === 0) {
    // Everyone left mid-round.
    lobby.state = "waiting";
    broadcastPlayers(lobby);
    return;
  }

  const chosenId = pool[Math.floor(Math.random() * pool.length)];
  const chosen = lobby.players.get(chosenId);
  lobby.state = "result";
  touch(lobby);

  lobby.history.unshift({ id: chosen.id, name: chosen.name, at: Date.now() });
  lobby.history = lobby.history.slice(0, MAX_HISTORY);

  io.to(lobby.roomCode).emit("round_result", {
    chosenPlayerId: chosen.id,
    chosenPlayerName: chosen.name,
    chosenEmoji: chosen.emoji,
    chosenColor: chosen.color,
    history: lobby.history,
  });
}

function resetLobby(lobby) {
  clearTimers(lobby);
  lobby.ready = new Set();
  lobby.state = "waiting";
  touch(lobby);
  io.to(lobby.roomCode).emit("lobby_reset", {});
  broadcastPlayers(lobby);
}

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  // Helper to find the lobby this socket belongs to.
  const getLobby = () => {
    const code = socket.data.roomCode;
    return code ? lobbies.get(code) : null;
  };

  socket.on("create_lobby", ({ hostName, emoji, color }, ack) => {
    const roomCode = genCode();
    const lobby = {
      roomCode,
      hostId: socket.id,
      players: new Map(),
      ready: new Set(),
      state: "waiting",
      history: [],
      timers: { countdown: null, selectTimeout: null, allReady: null },
      lastActivity: Date.now(),
    };
    const player = {
      id: socket.id,
      name: (hostName || "Host").slice(0, 16),
      emoji: chooseEmoji(lobby, emoji),
      color: chooseColor(lobby, color),
      ...spawnPosition(lobby),
    };
    lobby.players.set(socket.id, player);
    lobbies.set(roomCode, lobby);

    socket.data.roomCode = roomCode;
    socket.join(roomCode);

    if (ack) ack({ ok: true, roomCode, you: player });
    broadcastPlayers(lobby);
  });

  socket.on("join_lobby", ({ roomCode, playerName, emoji, color }, ack) => {
    const code = (roomCode || "").toUpperCase().trim();
    const lobby = lobbies.get(code);
    if (!lobby) {
      if (ack) ack({ ok: false, error: "Lobby not found" });
      return;
    }
    const player = {
      id: socket.id,
      name: (playerName || "Player").slice(0, 16),
      emoji: chooseEmoji(lobby, emoji),
      color: chooseColor(lobby, color),
      ...spawnPosition(lobby),
    };
    lobby.players.set(socket.id, player);
    socket.data.roomCode = code;
    socket.join(code);
    touch(lobby);

    if (ack)
      ack({
        ok: true,
        roomCode: code,
        you: player,
        state: lobby.state,
        history: lobby.history,
      });
    broadcastPlayers(lobby);
  });

  socket.on("start_round", () => {
    const lobby = getLobby();
    if (!lobby) return;
    if (socket.id !== lobby.hostId) return; // host only
    if (lobby.state !== "waiting" && lobby.state !== "result") return;
    startRound(lobby);
  });

  // Live drag: each client streams its own puck's normalized position; we store
  // it (for late-joiners) and rebroadcast to everyone else. volatile = drop under
  // backpressure since the next update corrects it ~50ms later.
  socket.on("move", (pos) => {
    const lobby = getLobby();
    if (!lobby) return;
    const p = lobby.players.get(socket.id);
    if (!p) return;
    const nx = clamp01(pos?.x);
    const ny = clamp01(pos?.y);
    if (nx == null || ny == null) return;
    p.x = nx;
    p.y = ny;
    touch(lobby);
    socket.to(lobby.roomCode).volatile.emit("player_moved", {
      id: socket.id,
      x: nx,
      y: ny,
    });
  });

  socket.on("player_ready", () => {
    const lobby = getLobby();
    if (lobby) onPlayerReady(lobby, socket.id);
  });

  socket.on("player_unready", () => {
    const lobby = getLobby();
    if (lobby) onPlayerUnready(lobby, socket.id);
  });

  socket.on("play_again", () => {
    const lobby = getLobby();
    if (!lobby) return;
    if (socket.id !== lobby.hostId) return; // host only
    resetLobby(lobby);
  });

  socket.on("leave_lobby", () => {
    handleLeave(socket);
  });

  socket.on("disconnect", () => {
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const lobby = lobbies.get(code);
  if (!lobby) return;

  const wasHost = socket.id === lobby.hostId;
  lobby.players.delete(socket.id);
  lobby.ready.delete(socket.id);
  socket.leave(code);
  socket.data.roomCode = null;
  touch(lobby);

  // Empty lobby -> destroy.
  if (lobby.players.size === 0) {
    destroyLobby(lobby, "empty");
    return;
  }

  // Promote a new host if needed.
  if (wasHost) {
    const next = lobby.players.keys().next().value;
    lobby.hostId = next;
    io.to(lobby.roomCode).emit("host_changed", { hostId: next });
  }

  // If we were mid-selection, re-check whether the remaining players resolve it.
  if (lobby.state === "selecting") {
    emitReadyCount(lobby);
    maybeResolve(lobby);
  }

  broadcastPlayers(lobby);
}

// ---------------------------------------------------------------------------
// Inactive-lobby reaper
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const lobby of lobbies.values()) {
    if (now - lobby.lastActivity > LOBBY_TTL_MS) {
      destroyLobby(lobby, "expired");
    }
  }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// Serve the built client in production (optional single-deploy mode)
// ---------------------------------------------------------------------------
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) res.status(200).send("Chwazi server running. Build the client to serve it here.");
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Chwazi server listening on http://0.0.0.0:${PORT}`);
});
