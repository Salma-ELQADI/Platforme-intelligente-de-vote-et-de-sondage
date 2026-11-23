import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';
import { closeExpiredPolls } from '../src/modules/polls/polls.service';
import { initSocket } from '../src/socket';
import { setIo } from '../src/socket/realtime';
import { app, closeDb, createPoll, createUser, expirePoll, resetDb, type TestUser } from './helpers';

let server: http.Server;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(app);
  initSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  setIo(null);
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
});
beforeEach(resetDb);
afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

function connect(user?: TestUser): Promise<Socket> {
  const socket = ioClient(url, { auth: user ? { token: user.token } : {}, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

const join = (socket: Socket, pollId: string) =>
  socket.emitWithAck('poll:join', { pollId }) as Promise<{ ok: boolean; data?: { results: { totalVotes: number } }; error?: { code: string } }>;

/** Resolves with the next `event`, or with null if nothing arrives within `ms`. */
const nextEvent = <T>(socket: Socket, event: string, ms = 1500) =>
  new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

describe('Socket.IO real-time layer', () => {
  it('refuses unauthenticated connections', async () => {
    await expect(connect()).rejects.toThrow('UNAUTHORIZED');
  });

  it('returns a results snapshot on poll:join and refuses drafts of other users', async () => {
    const owner = await createUser();
    const other = await createUser();
    const poll = await createPoll(owner);
    const draft = await createPoll(owner, { question: 'Brouillon secret ?' }, { publish: false });
    const socket = await connect(other);

    const ok = await join(socket, poll.id);
    expect(ok).toMatchObject({ ok: true, data: { results: { totalVotes: 0 } } });

    const refused = await join(socket, draft.id);
    expect(refused).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });

    const invalid = await join(socket, 'not-a-uuid');
    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('broadcasts updated results only to the room of the voted poll', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const pollA = await createPoll(owner);
    const pollB = await createPoll(owner, { question: 'Autre sondage ?' });

    const watcherA = await connect(owner);
    const watcherB = await connect(voter);
    await join(watcherA, pollA.id);
    await join(watcherB, pollB.id);

    const receivedA = nextEvent<{ pollId: string; totalVotes: number; options: { votes: number }[] }>(watcherA, 'poll:results');
    const receivedB = nextEvent(watcherB, 'poll:results', 800);

    await request(app).post(`/api/polls/${pollA.id}/votes`).set(voter.auth).send({ optionId: pollA.options[0].id }).expect(201);

    const payload = await receivedA;
    expect(payload).toMatchObject({ pollId: pollA.id, totalVotes: 1 });
    expect(payload!.options[0].votes).toBe(1);
    expect(await receivedB).toBeNull(); // room isolation
  });

  it('stops receiving updates after poll:leave', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner);
    const socket = await connect(owner);
    await join(socket, poll.id);
    expect(await socket.emitWithAck('poll:leave', { pollId: poll.id })).toEqual({ ok: true });

    const received = nextEvent(socket, 'poll:results', 800);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[0].id }).expect(201);
    expect(await received).toBeNull();
  });

  it('notifies the room and the voters when the scheduler closes an expired poll', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[1].id }).expect(201);

    const roomWatcher = await connect(owner);
    await join(roomWatcher, poll.id);
    const voterSocket = await connect(voter); // NOT in the poll room: notified through its personal room

    const closed = nextEvent<{ pollId: string; results: { visible: boolean; options: { votes: number }[] } }>(roomWatcher, 'poll:closed');
    const notified = nextEvent<{ type: string; pollId: string }>(voterSocket, 'notification:new');

    await expirePoll(poll.id);
    expect(await closeExpiredPolls()).toEqual([poll.id]);

    const closedPayload = await closed;
    expect(closedPayload).toMatchObject({ pollId: poll.id, results: { visible: true } });
    expect(closedPayload!.results.options[1].votes).toBe(1);
    expect(await notified).toMatchObject({ type: 'POLL_CLOSED', pollId: poll.id });
  });
});

describe('Automatic closure job', () => {
  it('closes only expired polls and is idempotent', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const expired = await createPoll(owner);
    const stillOpen = await createPoll(owner, { question: 'Encore ouvert ?' });
    await request(app).post(`/api/polls/${expired.id}/votes`).set(voter.auth).send({ optionId: expired.options[0].id }).expect(201);
    await expirePoll(expired.id);

    expect(await closeExpiredPolls()).toEqual([expired.id]);
    expect(await closeExpiredPolls()).toEqual([]); // second run: nothing to do

    const { rows } = await query<{ id: string; status: string }>('SELECT id, status FROM polls ORDER BY created_at');
    expect(rows.find((r) => r.id === expired.id)!.status).toBe('CLOSED');
    expect(rows.find((r) => r.id === stillOpen.id)!.status).toBe('ACTIVE');

    // Creator + voter notified exactly once.
    const notif = await query('SELECT user_id FROM notifications WHERE poll_id = $1', [expired.id]);
    expect(notif.rows.map((r) => r.user_id).sort()).toEqual([owner.id, voter.id].sort());

    const list = await request(app).get('/api/notifications').set(voter.auth).expect(200);
    expect(list.body.data.unreadCount).toBe(1);
    await request(app).patch('/api/notifications/read-all').set(voter.auth).expect(200);
    const after = await request(app).get('/api/notifications').set(voter.auth).expect(200);
    expect(after.body.data.unreadCount).toBe(0);
  });
});
