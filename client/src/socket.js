import { io } from "socket.io-client";

// Where the Socket.io server lives.
// - Dev: same host the page was loaded from, on port 3001 (so phones on the
//   LAN reach the server at the host machine's IP automatically).
// - Prod: same origin (the Express server serves the built client + sockets).
// - Override anytime with VITE_SERVER_URL.
function resolveServerUrl() {
  const override = import.meta.env.VITE_SERVER_URL;
  if (override) return override;
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }
  return window.location.origin;
}

export const SERVER_URL = resolveServerUrl();

// Stable per-browser identity that survives refresh/reconnect, so the server can
// rebind us to the same player slot instead of creating a duplicate.
export function getPlayerId() {
  let id = localStorage.getItem("chwazi_pid");
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("chwazi_pid", id);
  }
  return id;
}

export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
});

// ---- clock sync ----------------------------------------------------------
// Phone wall-clocks drift by hundreds of ms, so we never animate off raw
// Date.now(). We estimate an offset to server time and parameterize all timed
// animations (suspense sweep, reveal flood) against serverTime().
let clockOffset = 0;
export const serverTime = () => Date.now() + clockOffset;

export function syncClock(samples = 4) {
  let best = Infinity;
  let pending = samples;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    socket.emit("ping_time", { t0 }, (res) => {
      if (res && typeof res.serverNow === "number") {
        const t1 = Date.now();
        const rtt = t1 - t0;
        if (rtt < best) {
          best = rtt;
          clockOffset = res.serverNow + rtt / 2 - t1;
        }
      }
      pending -= 1;
    });
  }
}
