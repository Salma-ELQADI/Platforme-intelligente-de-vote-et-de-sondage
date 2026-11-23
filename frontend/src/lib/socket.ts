import { io, type Socket } from "socket.io-client";

export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:5000";

/**
 * Creates the Socket.IO connection. `withCredentials` sends the httpOnly
 * auth cookie with the handshake; the server authenticates the socket with it.
 * Socket.IO starts with HTTP long-polling and upgrades to WebSocket when possible,
 * and reconnects automatically after network interruptions.
 */
export function createSocket(): Socket {
  return io(SOCKET_URL, { withCredentials: true, autoConnect: true });
}
