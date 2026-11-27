/**
 * In-memory presence: number of open sockets per user. A user is "online"
 * while at least one tab is connected. This lives in the process memory, so
 * it is exact for a single API instance (the deployment used here); several
 * instances would need a shared store such as the Socket.IO Redis adapter.
 */
const sockets = new Map<string, number>();

/** Returns true when this is the user's first socket (they just came online). */
export function addSocket(userId: string): boolean {
  const n = (sockets.get(userId) ?? 0) + 1;
  sockets.set(userId, n);
  return n === 1;
}

/** Returns true when this was the user's last socket (they just went offline). */
export function removeSocket(userId: string): boolean {
  const n = (sockets.get(userId) ?? 1) - 1;
  if (n <= 0) {
    sockets.delete(userId);
    return true;
  }
  sockets.set(userId, n);
  return false;
}

export const isOnline = (userId: string) => sockets.has(userId);

export function resetPresence() {
  sockets.clear();
}
