import type { Server as HttpServer } from 'node:http';
import { parseCookie } from 'cookie';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AUTH_COOKIE, verifyToken } from '../modules/auth/auth.tokens';
import { findUserById } from '../modules/users/users.repository';
import { buildResults, getPollForViewer } from '../modules/polls/polls.service';
import type { PublicUser } from '../modules/users/users.types';
import { AppError } from '../utils/errors';
import { pollRoom, setIo, userRoom } from './realtime';

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string } }) => void;
interface SocketData {
  user: PublicUser;
}

const pollIdPayload = z.object({ pollId: z.uuid() });

/**
 * Socket.IO server attached to the same HTTP server as Express.
 *
 * Authentication happens once, during the handshake (io.use): the JWT is read
 * from the httpOnly cookie sent by the browser (or from `auth.token` for
 * non-browser clients). Unauthenticated connections are refused.
 */
export function initSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const token = cookies[AUTH_COOKIE] ?? (socket.handshake.auth?.token as string | undefined);
      const payload = token ? verifyToken(token) : null;
      const user = payload ? await findUserById(payload.sub) : null;
      if (!user || !user.isActive) return next(new Error('UNAUTHORIZED'));
      (socket.data as SocketData).user = user;
      next();
    } catch (err) {
      logger.error({ err }, 'Socket authentication failed');
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { user } = socket.data as SocketData;
    // Personal room: receives this user's notifications in every open tab.
    socket.join(userRoom(user.id));
    logger.debug({ userId: user.id, socketId: socket.id }, 'Socket connected');

    /**
     * poll:join { pollId } → ack { ok, data: { results } }
     * Checks that the user may see the poll, joins room "poll:<id>" and
     * returns a fresh results snapshot so the UI is correct immediately.
     */
    socket.on('poll:join', async (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
      const parsed = pollIdPayload.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'pollId invalide' } });
      try {
        const poll = await getPollForViewer(user, parsed.data.pollId);
        await socket.join(pollRoom(poll.id));
        const results = await buildResults({ ...poll, creatorId: poll.creator.id }, user);
        reply({ ok: true, data: { results } });
      } catch (err) {
        if (err instanceof AppError) return reply({ ok: false, error: { code: err.code, message: err.message } });
        logger.error({ err }, 'poll:join failed');
        reply({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur' } });
      }
    });

    /** poll:leave { pollId } → ack { ok } */
    socket.on('poll:leave', async (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
      const parsed = pollIdPayload.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'pollId invalide' } });
      await socket.leave(pollRoom(parsed.data.pollId));
      reply({ ok: true });
    });

    socket.on('disconnect', (reason) => {
      // Socket.IO removes the socket from all its rooms automatically.
      logger.debug({ userId: user.id, reason }, 'Socket disconnected');
    });
  });

  setIo(io);
  return io;
}
