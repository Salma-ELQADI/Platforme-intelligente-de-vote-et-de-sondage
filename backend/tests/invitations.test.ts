import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initSocket } from '../src/socket';
import { setIo } from '../src/socket/realtime';
import { app, closeDb, createUser, inOneHour, resetDb, type TestUser } from './helpers';

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
afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));

const connect = (user: TestUser) =>
  new Promise<Socket>((resolve, reject) => {
    const s = ioClient(url, { auth: { token: user.token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });

async function group(owner: TestUser, invitees: TestUser[], name = 'Équipe produit') {
  const res = await request(app).post('/api/conversations/groups').set(owner.auth).send({ name, memberIds: invitees.map((i) => i.id) }).expect(201);
  return res.body.data.conversation as { id: string; members: { id: string }[]; invitations: { id: string; userId: string }[] };
}
const myInvitations = async (u: TestUser) =>
  (await request(app).get('/api/invitations').set(u.auth).expect(200)).body.data.invitations as { id: string; group: { id: string; name: string }; invitedBy: { username: string } }[];

describe('Group invitations', () => {
  it('invites instead of adding: the invitee is not a member until they accept', async () => {
    const owner = await createUser();
    const bob = await createUser();
    const g = await group(owner, [bob]);
    expect(g.members.map((m) => m.id)).toEqual([owner.id]);
    expect(g.invitations.map((i) => i.userId)).toEqual([bob.id]);

    // Not a member yet: the group stays hidden.
    await request(app).get(`/api/conversations/${g.id}`).set(bob.auth).expect(404);

    const [inv] = await myInvitations(bob);
    expect(inv).toMatchObject({ group: { id: g.id, name: 'Équipe produit' }, invitedBy: { username: owner.username } });
    const notif = (await request(app).get('/api/notifications').set(bob.auth)).body.data.notifications[0];
    expect(notif).toMatchObject({ type: 'GROUP_INVITE', isRead: false, invitation: { id: inv.id, status: 'PENDING', groupName: 'Équipe produit' } });

    const accepted = await request(app).post(`/api/invitations/${inv.id}/accept`).set(bob.auth).expect(200);
    expect(accepted.body.data.conversation.members.map((m: { id: string }) => m.id).sort()).toEqual([owner.id, bob.id].sort());
    expect(await myInvitations(bob)).toHaveLength(0);
    const after = (await request(app).get('/api/notifications').set(bob.auth)).body.data.notifications[0];
    expect(after).toMatchObject({ isRead: true, invitation: { status: 'ACCEPTED' } });

    // Answered once only.
    expect((await request(app).post(`/api/invitations/${inv.id}/decline`).set(bob.auth)).body.error.code).toBe('INVITATION_ANSWERED');
  });

  it('lets the invitee decline, and only the invitee answer', async () => {
    const owner = await createUser();
    const bob = await createUser();
    const eve = await createUser();
    const g = await group(owner, [bob]);
    const [inv] = await myInvitations(bob);

    await request(app).post(`/api/invitations/${inv.id}/accept`).set(eve.auth).expect(404);
    await request(app).post(`/api/invitations/${inv.id}/accept`).set(owner.auth).expect(404);
    await request(app).post(`/api/invitations/${inv.id}/decline`).set(bob.auth).expect(200);
    await request(app).get(`/api/conversations/${g.id}`).set(bob.auth).expect(404);
    const view = (await request(app).get(`/api/conversations/${g.id}`).set(owner.auth)).body.data.conversation;
    expect(view.invitations).toHaveLength(0);

    // Declined people can be invited again; members and pending invitees are not invited twice.
    await request(app).post(`/api/conversations/${g.id}/members`).set(owner.auth).send({ userIds: [bob.id] }).expect(200);
    await request(app).post(`/api/conversations/${g.id}/members`).set(owner.auth).send({ userIds: [bob.id] }).expect(200);
    expect(await myInvitations(bob)).toHaveLength(1);
  });

  it('lets a group admin withdraw an invitation, but not a member', async () => {
    const owner = await createUser();
    const bob = await createUser();
    const carol = await createUser();
    const g = await group(owner, [bob, carol]);
    const [bobInv] = await myInvitations(bob);
    await request(app).post(`/api/invitations/${bobInv.id}/accept`).set(bob.auth).expect(200);
    const [carolInv] = await myInvitations(carol);

    await request(app).delete(`/api/conversations/${g.id}/invitations/${carolInv.id}`).set(bob.auth).expect(403);
    await request(app).delete(`/api/conversations/${g.id}/invitations/${carolInv.id}`).set(owner.auth).expect(200);
    expect(await myInvitations(carol)).toHaveLength(0);
    await request(app).post(`/api/invitations/${carolInv.id}/accept`).set(carol.auth).expect(409);
  });

  it('delivers the invitation in real time as a notification', async () => {
    const owner = await createUser();
    const bob = await createUser();
    const s = await connect(bob);
    const received = new Promise<{ type: string; invitation: { groupName: string } }>((resolve) => s.once('notification:new', resolve));
    await group(owner, [bob], 'Les amis du week-end');
    expect(await received).toMatchObject({ type: 'GROUP_INVITE', invitation: { groupName: 'Les amis du week-end' } });
  });

  it('keeps group polls hidden from people who have only been invited', async () => {
    const owner = await createUser();
    const bob = await createUser();
    const g = await group(owner, [bob]);
    const res = await request(app)
      .post('/api/polls')
      .set(owner.auth)
      .send({ question: 'Où allons-nous ce week-end ?', options: ['Plage', 'Montagne'], endTime: inOneHour(), access: 'GROUP', groupId: g.id })
      .expect(201);
    await request(app).post(`/api/polls/${res.body.data.poll.id}/publish`).set(owner.auth).expect(200);
    await request(app).get(`/api/polls/${res.body.data.poll.id}`).set(bob.auth).expect(404);
  });
});

describe('Precise validation codes', () => {
  it('tells the author they cannot invite themselves, with a code clients can translate', async () => {
    const owner = await createUser();
    const res = await request(app)
      .post('/api/polls')
      .set(owner.auth)
      .send({ question: 'Une question privée ?', options: ['Oui', 'Non'], endTime: inOneHour(), access: 'PRIVATE', voters: [owner.username] })
      .expect(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'voters', code: 'SELF_INVITE' })]);

    const unknown = await request(app)
      .post('/api/polls')
      .set(owner.auth)
      .send({ question: 'Une question privée ?', options: ['Oui', 'Non'], endTime: inOneHour(), access: 'PRIVATE', voters: ['nobody_here'] })
      .expect(400);
    expect(unknown.body.error.details[0]).toMatchObject({ field: 'voters', code: 'UNKNOWN_VOTERS', params: { names: 'nobody_here' } });
  });
});
