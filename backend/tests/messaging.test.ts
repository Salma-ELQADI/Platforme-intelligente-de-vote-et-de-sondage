import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';
import { initSocket } from '../src/socket';
import { resetPresence } from '../src/socket/presence';
import { setIo } from '../src/socket/realtime';
import { app, closeDb, createUser, resetDb, type TestUser } from './helpers';

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
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  await new Promise((r) => setTimeout(r, 30)); // let the server process the disconnections
  resetPresence();
});

function connect(user: TestUser): Promise<Socket> {
  const socket = ioClient(url, { auth: { token: user.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

/** Resolves with the next `event` matching `filter`, or null after `ms`. */
const nextEvent = <T>(socket: Socket, event: string, ms = 1500, filter: (p: T) => boolean = () => true) =>
  new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      resolve(null);
    }, ms);
    const listener = (payload: T) => {
      if (!filter(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });

async function openDirect(a: TestUser, b: TestUser) {
  const res = await request(app).post('/api/conversations/direct').set(a.auth).send({ userId: b.id });
  return res.body.data.conversation as { id: string; type: string; members: { id: string }[] };
}

async function createGroup(owner: TestUser, members: TestUser[], name = 'Rédaction') {
  const res = await request(app)
    .post('/api/conversations/groups')
    .set(owner.auth)
    .send({ name, memberIds: members.map((m) => m.id) })
    .expect(201);
  return res.body.data.conversation as { id: string; myRole: string; members: { id: string; role: string }[] };
}

const send = (user: TestUser, conversationId: string, body: string, clientId: string = randomUUID()) =>
  request(app).post(`/api/conversations/${conversationId}/messages`).set(user.auth).send({ body, clientId });

describe('Private conversations (REST)', () => {
  it('creates a single direct conversation per pair, whoever starts it', async () => {
    const alice = await createUser();
    const bob = await createUser();

    const first = await request(app).post('/api/conversations/direct').set(alice.auth).send({ userId: bob.id }).expect(201);
    const again = await request(app).post('/api/conversations/direct').set(alice.auth).send({ userId: bob.id }).expect(200);
    const reverse = await request(app).post('/api/conversations/direct').set(bob.auth).send({ userId: alice.id }).expect(200);

    expect(again.body.data.conversation.id).toBe(first.body.data.conversation.id);
    expect(reverse.body.data.conversation.id).toBe(first.body.data.conversation.id);
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM conversations');
    expect(rows[0].n).toBe(1);
  });

  it('survives concurrent creation of the same direct conversation', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const results = await Promise.all([
      request(app).post('/api/conversations/direct').set(alice.auth).send({ userId: bob.id }),
      request(app).post('/api/conversations/direct').set(bob.auth).send({ userId: alice.id }),
      request(app).post('/api/conversations/direct').set(alice.auth).send({ userId: bob.id }),
    ]);
    expect(new Set(results.map((r) => r.body.data.conversation.id)).size).toBe(1);
  });

  it('refuses a conversation with yourself or with an unknown user', async () => {
    const alice = await createUser();
    await request(app).post('/api/conversations/direct').set(alice.auth).send({ userId: alice.id }).expect(400);
    await request(app).post('/api/conversations/direct').set(alice.auth).send({ userId: randomUUID() }).expect(404);
    await request(app).post('/api/conversations/direct').send({ userId: randomUUID() }).expect(401);
  });

  it('sends messages, paginates history and tracks unread counts', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const conv = await openDirect(alice, bob);

    // An empty direct conversation is only listed for the person who opened it.
    expect((await request(app).get('/api/conversations').set(bob.auth)).body.data.conversations).toHaveLength(0);

    for (let i = 1; i <= 5; i++) await send(alice, conv.id, `Message ${i}`).expect(201);

    const list = await request(app).get('/api/conversations').set(bob.auth).expect(200);
    expect(list.body.data.conversations).toHaveLength(1);
    expect(list.body.data.conversations[0]).toMatchObject({ unreadCount: 5, lastMessage: { body: 'Message 5' } });
    expect((await request(app).get('/api/conversations/unread-count').set(bob.auth)).body.data.total).toBe(5);
    // Your own messages are never unread.
    expect((await request(app).get('/api/conversations/unread-count').set(alice.auth)).body.data.total).toBe(0);

    const page1 = await request(app).get(`/api/conversations/${conv.id}/messages?limit=2`).set(bob.auth).expect(200);
    expect(page1.body.data.messages.map((m: { body: string }) => m.body)).toEqual(['Message 4', 'Message 5']);
    expect(page1.body.data.hasMore).toBe(true);
    const page2 = await request(app)
      .get(`/api/conversations/${conv.id}/messages?limit=10&before=${page1.body.data.messages[0].seq}`)
      .set(bob.auth)
      .expect(200);
    expect(page2.body.data.messages.map((m: { body: string }) => m.body)).toEqual(['Message 1', 'Message 2', 'Message 3']);
    expect(page2.body.data.hasMore).toBe(false);

    // Catch-up after a reconnection: everything newer than a known seq.
    const after = await request(app).get(`/api/conversations/${conv.id}/messages?after=${page2.body.data.messages[2].seq}`).set(bob.auth);
    expect(after.body.data.messages.map((m: { body: string }) => m.body)).toEqual(['Message 4', 'Message 5']);

    // Partial read, then full read; a stale read cannot move the position backwards.
    const third = page2.body.data.messages[2].seq;
    await request(app).post(`/api/conversations/${conv.id}/read`).set(bob.auth).send({ seq: third }).expect(200);
    expect((await request(app).get('/api/conversations/unread-count').set(bob.auth)).body.data.total).toBe(2);
    await request(app).post(`/api/conversations/${conv.id}/read`).set(bob.auth).expect(200);
    await request(app).post(`/api/conversations/${conv.id}/read`).set(bob.auth).send({ seq: 1 }).expect(200);
    expect((await request(app).get('/api/conversations/unread-count').set(bob.auth)).body.data.total).toBe(0);
  });

  it('is idempotent on clientId (retries never duplicate a message)', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const conv = await openDirect(alice, bob);
    const clientId = randomUUID();

    const first = await send(alice, conv.id, 'Bonjour', clientId).expect(201);
    const retry = await send(alice, conv.id, 'Bonjour', clientId).expect(200);
    expect(retry.body.data.message.id).toBe(first.body.data.message.id);
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM messages');
    expect(rows[0].n).toBe(1);
  });

  it('validates message bodies and ignores any client-supplied sender', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const conv = await openDirect(alice, bob);

    await send(alice, conv.id, '   ').expect(400);
    await send(alice, conv.id, 'x'.repeat(2001)).expect(400);
    await request(app).post(`/api/conversations/${conv.id}/messages`).set(alice.auth).send({ body: 'Salut', clientId: 'nope' }).expect(400);

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set(alice.auth)
      .send({ body: '  <script>alert(1)</script>\r\nligne 2 ', clientId: randomUUID(), senderId: bob.id })
      .expect(201);
    expect(res.body.data.message.sender.id).toBe(alice.id);
    // Stored as text (escaping is the renderer's job), normalised and trimmed.
    expect(res.body.data.message.body).toBe('<script>alert(1)</script>\nligne 2');
  });

  it('hides conversations from non-members, platform admins included', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const eve = await createUser();
    const admin = await createUser('admin');
    const conv = await openDirect(alice, bob);
    await send(alice, conv.id, 'Secret').expect(201);

    for (const outsider of [eve, admin]) {
      await request(app).get(`/api/conversations/${conv.id}`).set(outsider.auth).expect(404);
      await request(app).get(`/api/conversations/${conv.id}/messages`).set(outsider.auth).expect(404);
      await send(outsider, conv.id, 'Intrusion').expect(404);
      await request(app).post(`/api/conversations/${conv.id}/read`).set(outsider.auth).expect(404);
      expect((await request(app).get('/api/conversations').set(outsider.auth)).body.data.conversations).toHaveLength(0);
    }
    // Direct conversations cannot be turned into groups.
    await request(app).post(`/api/conversations/${conv.id}/members`).set(alice.auth).send({ userIds: [eve.id] }).expect(400);
  });

  it('rate limits message floods per user', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const conv = await openDirect(alice, bob);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await send(alice, conv.id, `m${i}`)).status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.at(-1)).toBe(429);
  });

  it('searches conversations by group name or participant username', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    await createGroup(alice, [carol], 'Club de lecture');
    const direct = await openDirect(alice, bob);
    await send(alice, direct.id, 'Salut').expect(201);

    const byName = await request(app).get('/api/conversations?search=lecture').set(alice.auth);
    expect(byName.body.data.conversations.map((c: { name: string }) => c.name)).toEqual(['Club de lecture']);
    const byUser = await request(app).get(`/api/conversations?search=${bob.username}`).set(alice.auth);
    expect(byUser.body.data.conversations.map((c: { id: string }) => c.id)).toEqual([direct.id]);
  });
});

describe('Group conversations (REST)', () => {
  it('creates a group whose creator is administrator', async () => {
    const owner = await createUser();
    const a = await createUser();
    const b = await createUser();
    const group = await createGroup(owner, [a, b, a]); // duplicates are ignored
    expect(group.myRole).toBe('ADMIN');
    expect(group.members).toHaveLength(3);
    expect(group.members.find((m) => m.id === a.id)!.role).toBe('MEMBER');

    await request(app).post('/api/conversations/groups').set(owner.auth).send({ name: '  ', memberIds: [a.id] }).expect(400);
    await request(app).post('/api/conversations/groups').set(owner.auth).send({ name: 'Seul', memberIds: [] }).expect(400);
    await request(app).post('/api/conversations/groups').set(owner.auth).send({ name: 'X', memberIds: [randomUUID()] }).expect(400);
  });

  it('enforces administrator permissions on the backend', async () => {
    const owner = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const group = await createGroup(owner, [member]);

    await request(app).patch(`/api/conversations/${group.id}`).set(member.auth).send({ name: 'Pirate' }).expect(403);
    await request(app).post(`/api/conversations/${group.id}/members`).set(member.auth).send({ userIds: [outsider.id] }).expect(403);
    await request(app).delete(`/api/conversations/${group.id}/members/${owner.id}`).set(member.auth).expect(403);
    await request(app).patch(`/api/conversations/${group.id}/members/${member.id}`).set(member.auth).send({ role: 'ADMIN' }).expect(403);
    await request(app).patch(`/api/conversations/${group.id}`).set(outsider.auth).send({ name: 'Pirate' }).expect(404);

    const renamed = await request(app).patch(`/api/conversations/${group.id}`).set(owner.auth).send({ name: 'Nouvelle une' }).expect(200);
    expect(renamed.body.data.conversation.name).toBe('Nouvelle une');

    // The last administrator cannot demote themselves.
    const demote = await request(app).patch(`/api/conversations/${group.id}/members/${owner.id}`).set(owner.auth).send({ role: 'MEMBER' });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('LAST_ADMIN');
    await request(app).patch(`/api/conversations/${group.id}/members/${member.id}`).set(owner.auth).send({ role: 'ADMIN' }).expect(200);
  });

  it('removed members lose access to the group and its later messages', async () => {
    const owner = await createUser();
    const member = await createUser();
    const removed = await createUser();
    const group = await createGroup(owner, [member, removed]);
    await send(owner, group.id, 'Avant le départ').expect(201);
    await request(app).get(`/api/conversations/${group.id}/messages`).set(removed.auth).expect(200);

    await request(app).delete(`/api/conversations/${group.id}/members/${removed.id}`).set(owner.auth).expect(200);

    await send(owner, group.id, 'Après le départ').expect(201);
    await request(app).get(`/api/conversations/${group.id}/messages`).set(removed.auth).expect(404);
    await send(removed, group.id, 'Encore là ?').expect(404);
    expect((await request(app).get('/api/conversations').set(removed.auth)).body.data.conversations).toHaveLength(0);
    expect((await request(app).get('/api/conversations/unread-count').set(removed.auth)).body.data.total).toBe(0);
  });

  it('new members start caught up; leaving promotes a new admin; the last one out deletes the group', async () => {
    const owner = await createUser();
    const member = await createUser();
    const late = await createUser();
    const group = await createGroup(owner, [member]);
    await send(owner, group.id, 'Historique').expect(201);

    await request(app).post(`/api/conversations/${group.id}/members`).set(owner.auth).send({ userIds: [late.id] }).expect(200);
    const lateView = await request(app).get(`/api/conversations/${group.id}`).set(late.auth).expect(200);
    expect(lateView.body.data.conversation.unreadCount).toBe(0);

    await request(app).delete(`/api/conversations/${group.id}/members/${owner.id}`).set(owner.auth).expect(200);
    const after = await request(app).get(`/api/conversations/${group.id}`).set(member.auth).expect(200);
    expect(after.body.data.conversation.members.find((m: { id: string }) => m.id === member.id).role).toBe('ADMIN');

    await request(app).delete(`/api/conversations/${group.id}/members/${member.id}`).set(member.auth).expect(200);
    await request(app).delete(`/api/conversations/${group.id}/members/${late.id}`).set(late.auth).expect(200);
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM conversations WHERE id = $1', [group.id]);
    expect(rows[0].n).toBe(0);
  });

  it('carries sender names in group history', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member]);
    await send(owner, group.id, 'Un').expect(201);
    await send(member, group.id, 'Deux').expect(201);
    const res = await request(app).get(`/api/conversations/${group.id}/messages`).set(owner.auth);
    expect(res.body.data.messages.map((m: { sender: { username: string } }) => m.sender.username)).toEqual([owner.username, member.username]);
  });
});

describe('Messaging over Socket.IO', () => {
  it('delivers messages only to members, with unread updates', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const eve = await createUser();
    const conv = await openDirect(alice, bob);
    const [sa, sb, se] = await Promise.all([connect(alice), connect(bob), connect(eve)]);

    const toBob = nextEvent<{ message: { body: string; sender: { id: string } } }>(sb, 'message:new');
    const echo = nextEvent<{ message: { body: string } }>(sa, 'message:new');
    const unread = nextEvent<{ total: number; conversationId: string; unreadCount: number }>(sb, 'unread:update');
    const toEve = nextEvent(se, 'message:new', 600);

    const ack = await sa.emitWithAck('message:send', { conversationId: conv.id, body: 'Coucou', clientId: randomUUID() });
    expect(ack).toMatchObject({ ok: true, data: { message: { body: 'Coucou', sender: { id: alice.id } } } });

    expect(await toBob).toMatchObject({ message: { body: 'Coucou', sender: { id: alice.id } } });
    expect(await echo).toMatchObject({ message: { body: 'Coucou' } }); // the sender's other tabs stay in sync
    expect(await unread).toEqual({ total: 1, conversationId: conv.id, unreadCount: 1 });
    expect(await toEve).toBeNull();
  });

  it('refuses socket sends to conversations the user does not belong to', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const eve = await createUser();
    const conv = await openDirect(alice, bob);
    const se = await connect(eve);
    const sb = await connect(bob);
    const leaked = nextEvent(sb, 'message:new', 600);

    const ack = await se.emitWithAck('message:send', { conversationId: conv.id, body: 'Intrusion', clientId: randomUUID() });
    expect(ack).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await se.emitWithAck('message:send', { conversationId: 'x', body: 'a', clientId: randomUUID() })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(await se.emitWithAck('typing', { conversationId: conv.id, isTyping: true })).toMatchObject({ ok: false });
    expect(await leaked).toBeNull();
  });

  it('a duplicated send (lost ack + retry) is delivered once', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const conv = await openDirect(alice, bob);
    const [sa, sb] = await Promise.all([connect(alice), connect(bob)]);
    let received = 0;
    sb.on('message:new', () => (received += 1));

    const clientId = randomUUID();
    const payload = { conversationId: conv.id, body: 'Une seule fois', clientId };
    const [a, b] = await Promise.all([sa.emitWithAck('message:send', payload), sa.emitWithAck('message:send', payload)]);
    expect(a.data.message.id).toBe(b.data.message.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toBe(1);
  });

  it('relays typing indicators and read receipts', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner, [member]);
    const [so, sm] = await Promise.all([connect(owner), connect(member)]);

    const typing = nextEvent<{ conversationId: string; user: { id: string }; isTyping: boolean }>(sm, 'typing');
    const selfTyping = nextEvent(so, 'typing', 500);
    expect(await so.emitWithAck('typing', { conversationId: group.id, isTyping: true })).toMatchObject({ ok: true });
    expect(await typing).toEqual({ conversationId: group.id, user: { id: owner.id, username: owner.username }, isTyping: true });
    expect(await selfTyping).toBeNull(); // not echoed to the typist

    const sent = await so.emitWithAck('message:send', { conversationId: group.id, body: 'Lu ?', clientId: randomUUID() });
    const receipt = nextEvent<{ conversationId: string; userId: string; lastReadSeq: number }>(so, 'conversation:read');
    const unread = nextEvent<{ total: number }>(sm, 'unread:update');
    expect(await sm.emitWithAck('conversation:read', { conversationId: group.id })).toMatchObject({
      ok: true,
      data: { lastReadSeq: sent.data.message.seq },
    });
    expect(await receipt).toEqual({ conversationId: group.id, userId: member.id, lastReadSeq: sent.data.message.seq });
    expect(await unread).toMatchObject({ total: 0 });
  });

  it('stops delivering group messages to a removed member at once', async () => {
    const owner = await createUser();
    const member = await createUser();
    const removed = await createUser();
    const group = await createGroup(owner, [member, removed]);
    const [so, sr] = await Promise.all([connect(owner), connect(removed)]);

    const removedEvent = nextEvent<{ conversationId: string }>(sr, 'conversation:removed');
    await request(app).delete(`/api/conversations/${group.id}/members/${removed.id}`).set(owner.auth).expect(200);
    expect(await removedEvent).toEqual({ conversationId: group.id });

    const leaked = nextEvent(sr, 'message:new', 600);
    await so.emitWithAck('message:send', { conversationId: group.id, body: 'Entre nous', clientId: randomUUID() });
    expect(await leaked).toBeNull();
    expect(await sr.emitWithAck('message:send', { conversationId: group.id, body: 'Hé', clientId: randomUUID() })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('announces presence to contacts and reports it in conversations', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const conv = await openDirect(alice, bob);
    const sa = await connect(alice);

    const online = nextEvent<{ userId: string; online: boolean }>(sa, 'presence:update', 1500, (p) => p.userId === bob.id);
    const sb = await connect(bob);
    expect(await online).toEqual({ userId: bob.id, online: true });

    const view = await request(app).get(`/api/conversations/${conv.id}`).set(alice.auth);
    expect(view.body.data.conversation.members.find((m: { id: string }) => m.id === bob.id).online).toBe(true);

    const offline = nextEvent<{ userId: string; online: boolean }>(sa, 'presence:update', 1500, (p) => p.userId === bob.id && !p.online);
    sb.disconnect();
    expect(await offline).toEqual({ userId: bob.id, online: false });
  });

  it('a reconnected client catches up through REST with ?after=', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const conv = await openDirect(alice, bob);
    const first = await send(alice, conv.id, 'Avant la coupure').expect(201);

    const sb = await connect(bob);
    sb.disconnect(); // bob goes offline…
    await send(alice, conv.id, 'Pendant la coupure 1').expect(201);
    await send(alice, conv.id, 'Pendant la coupure 2').expect(201);
    await connect(bob); // …and comes back: the client asks for what it missed

    const missed = await request(app).get(`/api/conversations/${conv.id}/messages?after=${first.body.data.message.seq}`).set(bob.auth);
    expect(missed.body.data.messages.map((m: { body: string }) => m.body)).toEqual(['Pendant la coupure 1', 'Pendant la coupure 2']);
  });
});

describe('User preferences and directory', () => {
  it('stores language and theme preferences and returns them with the session', async () => {
    const alice = await createUser();
    const me = await request(app).get('/api/auth/me').set(alice.auth);
    expect(me.body.data.user.preferences).toEqual({ locale: null, theme: 'system', messageNotifications: true });

    await request(app).patch('/api/users/me/preferences').set(alice.auth).send({ locale: 'ar', theme: 'dark' }).expect(200);
    await request(app).patch('/api/users/me/preferences').set(alice.auth).send({ messageNotifications: false }).expect(200);
    const after = await request(app).get('/api/auth/me').set(alice.auth);
    expect(after.body.data.user.preferences).toEqual({ locale: 'ar', theme: 'dark', messageNotifications: false });

    await request(app).patch('/api/users/me/preferences').set(alice.auth).send({ locale: 'de' }).expect(400);
    await request(app).patch('/api/users/me/preferences').set(alice.auth).send({}).expect(400);
  });

  it('lists people by username without exposing emails', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const res = await request(app).get(`/api/users/directory?search=${bob.username.slice(0, 6)}`).set(alice.auth).expect(200);
    expect(res.body.data.users.some((u: { id: string }) => u.id === bob.id)).toBe(true);
    expect(res.body.data.users.every((u: object) => !('email' in u))).toBe(true);
    expect(res.body.data.users.some((u: { id: string }) => u.id === alice.id)).toBe(false);
    // LIKE wildcards are literal.
    expect((await request(app).get('/api/users/directory?search=%25').set(alice.auth)).body.data.users).toHaveLength(0);
  });
});
