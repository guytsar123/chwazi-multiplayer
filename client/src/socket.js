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

export const socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
});
