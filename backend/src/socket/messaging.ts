import type { Socket } from 'socket.io';
import type { ZodType } from 'zod';
import { logger } from '../config/logger';
import { listContactIds } from '../modules/messaging/messaging.repository';
import {
  socketReadSchema,
  socketSendSchema,
  socketTypingSchema,
} from '../modules/messaging/messaging.schemas';
import * as messaging from '../modules/messaging/messaging.service';
import type { PublicUser } from '../modules/users/users.types';
import { AppError } from '../utils/errors';
import { addSocket, isOnline, removeSocket } from './presence';
import { sendToUsers } from './realtime';

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string } }) => void;

/**
 * Wraps a handler: validates the payload with zod, runs it, and answers the
 * acknowledgement with { ok, data } or { ok:false, error } (AppError messages
 * only, never internal details).
 */
function handle<T>(socket: Socket, event: string, schema: ZodType<T>, fn: (payload: T) => Promise<unknown>) {
  socket.on(event, async (payload: unknown, ack?: Ack) => {
    const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Données invalides' } });
    }
    try {
      reply({ ok: true, data: await fn(parsed.data) });
    } catch (err) {
      if (err instanceof AppError) return reply({ ok: false, error: { code: err.code, message: err.message } });
      logger.error({ err, event }, 'Socket handler failed');
      reply({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' } });
    }
  });
}

/**
 * Messaging events of one authenticated socket. The user always comes from
 * the handshake (socket.data.user), never from the payload.
 *
 *  client → server (with ack)
 *    message:send  { conversationId, body, clientId } → { message }
 *    conversation:read { conversationId, seq? }        → { lastReadSeq }
 *    typing        { conversationId, isTyping }
 *  server → client
 *    message:new, conversation:updated, conversation:removed,
 *    conversation:read, unread:update, typing, presence:update
 */
export function registerMessagingHandlers(socket: Socket, user: PublicUser) {
  handle(socket, 'message:send', socketSendSchema, async ({ conversationId, body, clientId }) => {
    const { message } = await messaging.sendMessage(user, conversationId, { body, clientId });
    return { message };
  });

  handle(socket, 'conversation:read', socketReadSchema, ({ conversationId, seq }) => messaging.markRead(user, conversationId, seq));

  handle(socket, 'typing', socketTypingSchema, ({ conversationId, isTyping }) => messaging.relayTyping(user, conversationId, isTyping));

  // Presence: announced to contacts when the first tab opens and the last one closes.
  if (addSocket(user.id)) void announcePresence(user.id, true);
  socket.on('disconnect', () => {
    if (removeSocket(user.id)) void announcePresence(user.id, false);
  });
}

async function announcePresence(userId: string, online: boolean) {
  try {
    // A quick reconnection may have happened in between: report the real state.
    if (isOnline(userId) !== online) return;
    sendToUsers(await listContactIds(userId), 'presence:update', { userId, online });
  } catch (err) {
    logger.error({ err }, 'Presence broadcast failed');
  }
}
