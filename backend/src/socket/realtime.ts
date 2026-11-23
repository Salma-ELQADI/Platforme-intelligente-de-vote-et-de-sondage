import type { Server } from 'socket.io';
import type { PollResults } from '../modules/polls/polls.types';
import type { Notification } from '../modules/notifications/notifications.types';

/**
 * Thin wrapper around the Socket.IO server used by business services.
 * Services call these functions *after* their transaction has committed;
 * they never touch Socket.IO directly. If the socket server is not started
 * (e.g. in some unit tests) the calls are simply no-ops.
 */
let io: Server | null = null;

export const pollRoom = (pollId: string) => `poll:${pollId}`;
export const userRoom = (userId: string) => `user:${userId}`;

export function setIo(server: Server | null) {
  io = server;
}

/** Sent to everyone viewing the poll after each committed vote. */
export function broadcastResults(results: PollResults) {
  io?.to(pollRoom(results.pollId)).emit('poll:results', results);
}

/** Sent to everyone viewing the poll when it closes (manually or automatically). */
export function broadcastPollClosed(payload: { pollId: string; question: string; closedAt: string; results: PollResults }) {
  io?.to(pollRoom(payload.pollId)).emit('poll:closed', payload);
}

/** Sent to all sockets of a given user (every open tab), wherever they are in the app. */
export function sendNotification(userId: string, notification: Notification) {
  io?.to(userRoom(userId)).emit('notification:new', notification);
}
