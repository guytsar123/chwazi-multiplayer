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
// Tunable timing / rules (tuned to the original finger-chooser feel)
// ---------------------------------------------------------------------------
const COUNTDOWN_SECONDS = 3; // 3...2...1 sync cue before everyone holds
const SELECT_TIMEOUT_MS = 20000; // max wait for everyone to hold their finger
const SUSPENSE_MS = 2500; // hold-to-pick duration (~2.5s)
const REVEAL_MS = 1000; // winner color-flood duration
const RECONNECT_GRACE_MS = 20000; // keep a slot alive this long after a drop
const LOBBY_TTL_MS = 30 * 60 * 1000; // 30 min of inactivity -> cleanup
const MIN_PLAYERS = 2;
const MAX_HISTORY = 6;

const app = express();
app.use(cors());

// Cold-start UX: the client probes this before opening the socket so it can show
// a "waking up" state instead of a scary hang on a sleeping free-tier instance.
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ---------------------------------------------------------------------------
// In-memory lobby store (single free-tier instance -> a Map is correct)
// ---------------------------------------------------------------------------
/**
 * lobby = {
 *   roomCode, hostId (= playerId),
 *   players: Map<playerId, {
 *     id, name, emoji, color, socketId, connected, x, y
 *   }>,
 *   ready: Set<playerId>,
 *   mode: "one" | "multiple" | "groups",
 *   count: number,                 // winners (multiple) or groups (groups)
 *   state: "waiting" | "countdown" | "selecting" | "result",
 *   result: object | null,
 *   history: [{ name, at }],
 *   timers: { countdown, selectTimeout, suspense },
 *   grace: Map<playerId, timer>,
 *   lastActivity: number,
 * }
 */
const lobbies = new Map();

const CODE_CHARS = "0123456789"; // digits only — easy to type/share
// Bright, saturated palette (Material-400 family) on a dark stage — the modern
// modern look. Players may also pick their own; these are the auto-assign pool.
const COLORS = [
  "#ef5350", "#ec407a", "#ab47bc", "#7e57c2", "#5c6bc0",
  "#29b6f6", "#26a69a", "#66bb6a", "#9ccc65", "#ffee58",
  "#ffca28", "#ffa726", "#ff7043", "#42a5f5", "#d4e157",
];
// Team colors for groups mode (well-separated hues).
const TEAM_COLORS = [
  "#ef5350", "#42a5f5", "#66bb6a", "#ffca28",
  "#ab47bc", "#26a69a", "#ff7043", "#ec407a",
];
// crypto-grade Fisher-Yates shuffle (fair selection, untamperable).
function cryptoShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Even N-way partition, spreading any remainder across the first buckets.
function chunkify(arr, n) {
  const a = [...arr];
  const out = [];
  for (let i = n; i > 0; i--) out.push(a.splice(0, Math.ceil(a.length / i)));
  return out;
}

function genCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  } while (lobbies.has(code));
  return code;
}

function pickFrom(used, pool) {
  const free = pool.filter((c) => !used.has(c));
  const src = free.length ? free : pool;
  return src[randomInt(src.length)];
}

// Color is always auto-assigned at random from the pool, excluding colors already
// taken in this lobby, so no two players ever share a color (until the pool runs
// out). Any client-supplied color is ignored — selection is random-only.
function chooseColor(lobby) {
  return pickFrom(new Set([...lobby.players.values()].map((p) => p.color)), COLORS);
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

const clamp01 = (v) =>
  typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : null;

// Spread players around a ring (normalized) so they don't stack on first sight.
function spawnPosition(lobby) {
  const i = lobby.players.size;
  const total = i + 1;
  const ang = -Math.PI / 2 + (i / Math.max(total, 1)) * Math.PI * 2;
  const r = total === 1 ? 0 : 0.3;
  return { x: 0.5 + Math.cos(ang) * r, y: 0.5 + Math.sin(ang) * r };
}

function publicPlayers(lobby) {
  return [...lobby.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    isHost: p.id === lobby.hostId,
    connected: p.connected,
    x: p.x ?? 0.5,
    y: p.y ?? 0.5,
  }));
}

function lobbyConfig(lobby) {
  return { mode: lobby.mode, count: lobby.count };
}

function broadcastPlayers(lobby) {
  io.to(lobby.roomCode).emit("lobby_update", {
    players: publicPlayers(lobby),
    hostId: lobby.hostId,
    state: lobby.state,
    ...lobbyConfig(lobby),
  });
}

// One canonical full-state message for join / rejoin / late-join.
function snapshotFor(lobby, you) {
  return {
    roomCode: lobby.roomCode,
    hostId: lobby.hostId,
    state: lobby.state,
    serverNow: Date.now(),
    players: publicPlayers(lobby),
    history: lobby.history,
    result: lobby.result,
    you,
    ...lobbyConfig(lobby),
  };
}

const touch = (lobby) => (lobby.lastActivity = Date.now());

function destroyLobby(lobby, reason) {
  clearTimers(lobby);
  for (const t of lobby.grace.values()) clearTimeout(t);
  lobby.grace.clear();
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
  lobby.result = null;
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
    totalCount: countConnected(lobby),
    timeoutMs: SELECT_TIMEOUT_MS,
  });

  lobby.timers.selectTimeout = setTimeout(() => resolveRound(lobby), SELECT_TIMEOUT_MS);
}

const countConnected = (lobby) =>
  [...lobby.players.values()].filter((p) => p.connected).length;

function onPlayerReady(lobby, playerId) {
  if (lobby.state !== "selecting") return;
  if (!lobby.players.has(playerId)) return;
  lobby.ready.add(playerId);
  touch(lobby);
  emitReadyCount(lobby);
  maybeResolve(lobby);
}

function onPlayerUnready(lobby, playerId) {
  if (lobby.state !== "selecting") return;
  lobby.ready.delete(playerId);
  touch(lobby);
  emitReadyCount(lobby);
  // Holding finger lifted before the pick -> cancel the synchronized suspense.
  if (lobby.timers.suspense) {
    clearTimeout(lobby.timers.suspense);
    lobby.timers.suspense = null;
    io.to(lobby.roomCode).emit("suspense_cancelled", {});
  }
}

function emitReadyCount(lobby) {
  io.to(lobby.roomCode).emit("ready_update", {
    readyCount: lobby.ready.size,
    totalCount: countConnected(lobby),
    readyIds: [...lobby.ready],
  });
}

function maybeResolve(lobby) {
  if (lobby.state !== "selecting") return;
  const connected = countConnected(lobby);
  const everyone = connected > 0 && lobby.ready.size >= connected;
  if (everyone && !lobby.timers.suspense) {
    // Everybody holding -> synchronized suspense sweep, then pick. We send server
    // time + start + duration so every device animates the ring-fill in lockstep
    // and reveals at the same wall-clock moment.
    const serverNow = Date.now();
    io.to(lobby.roomCode).emit("suspense_started", {
      serverNow,
      startAt: serverNow,
      durationMs: SUSPENSE_MS,
    });
    lobby.timers.suspense = setTimeout(() => resolveRound(lobby), SUSPENSE_MS);
  }
}

function resolveRound(lobby) {
  if (lobby.state !== "selecting") return;
  clearTimers(lobby);

  // Eligible = players currently holding; fall back to everyone connected.
  let pool = [...lobby.ready].filter((id) => {
    const p = lobby.players.get(id);
    return p && p.connected;
  });
  if (pool.length === 0) {
    pool = [...lobby.players.values()].filter((p) => p.connected).map((p) => p.id);
  }
  if (pool.length === 0) {
    lobby.state = "waiting";
    broadcastPlayers(lobby);
    return;
  }

  lobby.state = "result";
  touch(lobby);
  const serverNow = Date.now();
  const revealAt = serverNow + 120; // small lead so all clients start together
  const pub = (id) => {
    const p = lobby.players.get(id);
    return { id: p.id, name: p.name, color: p.color };
  };

  let result;
  if (lobby.mode === "groups") {
    const groupCount = Math.max(2, Math.min(lobby.count, pool.length));
    const teams = cryptoShuffle(TEAM_COLORS);
    const buckets = chunkify(cryptoShuffle(pool), groupCount);
    const assignment = [];
    buckets.forEach((ids, gi) => {
      ids.forEach((id) =>
        assignment.push({ id, group: gi + 1, color: teams[gi % teams.length] })
      );
    });
    result = { mode: "groups", count: groupCount, groups: assignment };
    lobby.history.unshift({ name: `${groupCount} קבוצות`, at: Date.now() });
  } else {
    const n = lobby.mode === "multiple" ? Math.max(1, Math.min(lobby.count, pool.length)) : 1;
    const winnerIds = cryptoShuffle(pool).slice(0, n);
    const winners = winnerIds.map(pub);
    result = { mode: lobby.mode === "multiple" ? "multiple" : "one", count: n, winners };
    lobby.history.unshift({ name: winners.map((w) => w.name).join(", "), at: Date.now() });
  }

  lobby.history = lobby.history.slice(0, MAX_HISTORY);
  lobby.result = { ...result, serverNow, revealAt, durationMs: REVEAL_MS, history: lobby.history };
  io.to(lobby.roomCode).emit("round_result", lobby.result);
}

function resetLobby(lobby) {
  clearTimers(lobby);
  lobby.ready = new Set();
  lobby.result = null;
  lobby.state = "waiting";
  touch(lobby);
  io.to(lobby.roomCode).emit("lobby_reset", {});
  broadcastPlayers(lobby);
}

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  const getLobby = () => {
    const code = socket.data.roomCode;
    return code ? lobbies.get(code) : null;
  };
  const myId = () => socket.data.playerId;

  // Lightweight clock-sync: client estimates offset = serverNow + rtt/2 - t1.
  socket.on("ping_time", ({ t0 } = {}, ack) => {
    if (ack) ack({ t0, serverNow: Date.now() });
  });

  socket.on("create_lobby", ({ playerId, hostName, mode, count } = {}, ack) => {
    if (!playerId) { if (ack) ack({ ok: false, error: "מזהה חסר" }); return; }
    const roomCode = genCode();
    const lobby = {
      roomCode,
      hostId: playerId,
      players: new Map(),
      ready: new Set(),
      mode: ["one", "multiple", "groups"].includes(mode) ? mode : "one",
      count: clampCount(mode, count),
      state: "waiting",
      result: null,
      history: [],
      timers: { countdown: null, selectTimeout: null, suspense: null },
      grace: new Map(),
      lastActivity: Date.now(),
    };
    const player = {
      id: playerId,
      name: (hostName || "מארח").slice(0, 16),
      color: chooseColor(lobby),
      socketId: socket.id,
      connected: true,
      ...spawnPosition(lobby),
    };
    lobby.players.set(playerId, player);
    lobbies.set(roomCode, lobby);

    socket.data.roomCode = roomCode;
    socket.data.playerId = playerId;
    socket.join(roomCode);

    if (ack) ack({ ok: true, snapshot: snapshotFor(lobby, player) });
    broadcastPlayers(lobby);
  });

  socket.on("join_lobby", ({ playerId, roomCode, playerName } = {}, ack) => {
    if (!playerId) { if (ack) ack({ ok: false, error: "מזהה חסר" }); return; }
    const code = (roomCode || "").toString().trim();
    const lobby = lobbies.get(code);
    if (!lobby) { if (ack) ack({ ok: false, error: "החדר לא נמצא" }); return; }

    // Returning player (same token) -> rebind instead of adding a duplicate.
    let player = lobby.players.get(playerId);
    if (player) {
      bindSocket(lobby, player, socket);
    } else {
      player = {
        id: playerId,
        name: (playerName || "שחקן").slice(0, 16),
        color: chooseColor(lobby),
        socketId: socket.id,
        connected: true,
        ...spawnPosition(lobby),
      };
      lobby.players.set(playerId, player);
    }
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    socket.join(code);
    touch(lobby);

    if (ack) ack({ ok: true, snapshot: snapshotFor(lobby, player) });
    broadcastPlayers(lobby);
  });

  // Reconnect / refresh / tab-restore: rebind the existing slot, get full state.
  socket.on("rejoin", ({ playerId, roomCode } = {}, ack) => {
    const code = (roomCode || "").toString().trim();
    const lobby = lobbies.get(code);
    const player = lobby && playerId ? lobby.players.get(playerId) : null;
    if (!lobby || !player) { if (ack) ack({ ok: false, error: "החיבור פג" }); return; }
    bindSocket(lobby, player, socket);
    socket.data.roomCode = code;
    socket.data.playerId = playerId;
    socket.join(code);
    touch(lobby);
    if (ack) ack({ ok: true, snapshot: snapshotFor(lobby, player) });
    broadcastPlayers(lobby);
  });

  socket.on("set_mode", ({ mode, count } = {}) => {
    const lobby = getLobby();
    if (!lobby || myId() !== lobby.hostId) return;
    if (lobby.state !== "waiting" && lobby.state !== "result") return;
    if (["one", "multiple", "groups"].includes(mode)) lobby.mode = mode;
    lobby.count = clampCount(lobby.mode, count ?? lobby.count);
    touch(lobby);
    broadcastPlayers(lobby);
  });

  socket.on("start_round", () => {
    const lobby = getLobby();
    if (!lobby || myId() !== lobby.hostId) return;
    if (lobby.state !== "waiting" && lobby.state !== "result") return;
    startRound(lobby);
  });

  // Live drag: stream own normalized puck position; store + rebroadcast.
  socket.on("move", (pos) => {
    const lobby = getLobby();
    if (!lobby) return;
    const p = lobby.players.get(myId());
    if (!p) return;
    const nx = clamp01(pos?.x);
    const ny = clamp01(pos?.y);
    if (nx == null || ny == null) return;
    p.x = nx;
    p.y = ny;
    touch(lobby);
    socket.to(lobby.roomCode).volatile.emit("player_moved", { id: p.id, x: nx, y: ny });
  });

  socket.on("player_ready", () => {
    const lobby = getLobby();
    if (lobby) onPlayerReady(lobby, myId());
  });
  socket.on("player_unready", () => {
    const lobby = getLobby();
    if (lobby) onPlayerUnready(lobby, myId());
  });

  socket.on("play_again", () => {
    const lobby = getLobby();
    if (!lobby || myId() !== lobby.hostId) return;
    resetLobby(lobby);
  });

  socket.on("leave_lobby", () => handleLeave(socket, true));
  socket.on("disconnect", () => handleLeave(socket, false));
});

function clampCount(mode, count) {
  const n = Math.round(Number(count) || (mode === "groups" ? 2 : 1));
  if (mode === "groups") return Math.min(8, Math.max(2, n));
  if (mode === "multiple") return Math.min(8, Math.max(1, n));
  return 1;
}

// (Re)attach a live socket to an existing player slot and cancel any grace timer.
function bindSocket(lobby, player, socket) {
  const g = lobby.grace.get(player.id);
  if (g) {
    clearTimeout(g);
    lobby.grace.delete(player.id);
  }
  player.socketId = socket.id;
  player.connected = true;
}

// Explicit leave removes the slot; a disconnect starts a grace window so a
// refresh / tunnel / tab-switch doesn't kick the player or duplicate them.
function handleLeave(socket, explicit) {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code || !playerId) return;
  const lobby = lobbies.get(code);
  if (!lobby) return;
  const player = lobby.players.get(playerId);
  if (!player) return;
  // Ignore a stale disconnect from an old socket the player already replaced.
  if (!explicit && player.socketId !== socket.id) return;

  socket.leave(code);

  if (explicit) {
    removePlayer(lobby, playerId);
  } else {
    player.connected = false;
    emitReadyCount(lobby);
    broadcastPlayers(lobby);
    const t = setTimeout(() => {
      lobby.grace.delete(playerId);
      removePlayer(lobby, playerId);
    }, RECONNECT_GRACE_MS);
    lobby.grace.set(playerId, t);
  }
}

function removePlayer(lobby, playerId) {
  const wasHost = playerId === lobby.hostId;
  lobby.players.delete(playerId);
  lobby.ready.delete(playerId);
  touch(lobby);

  if (lobby.players.size === 0) {
    destroyLobby(lobby, "empty");
    return;
  }
  if (wasHost) {
    // Promote the longest-present connected player.
    const next =
      [...lobby.players.values()].find((p) => p.connected)?.id ||
      lobby.players.keys().next().value;
    lobby.hostId = next;
    io.to(lobby.roomCode).emit("host_changed", { hostId: next });
  }
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
    if (now - lobby.lastActivity > LOBBY_TTL_MS) destroyLobby(lobby, "expired");
  }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// Serve the built client in production (single-deploy mode)
// ---------------------------------------------------------------------------
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) res.status(200).send("choose-me server running. Build the client to serve it here.");
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`choose-me server listening on http://0.0.0.0:${PORT}`);
});
