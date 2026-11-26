import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, closeDb, createPoll, createUser, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

describe('Owner cannot vote', () => {
  it('rejects a vote from the creator of a public poll', async () => {
    const owner = await createUser();
    const poll = await createPoll(owner);
    const res = await request(app).post(`/api/polls/${poll.id}/votes`).set(owner.auth).send({ optionId: poll.options[0].id }).expect(403);
    expect(res.body.error.code).toBe('OWNER_CANNOT_VOTE');

    const detail = await request(app).get(`/api/polls/${poll.id}`).set(owner.auth).expect(200);
    expect(detail.body.data.poll.canVote).toBe(false);
  });
});

describe('Private polls', () => {
  it('accepts voters by username or email and only shows the list to the creator', async () => {
    const owner = await createUser();
    const alice = await createUser();
    const bob = await createUser();
    const poll = await createPoll(owner, { access: 'PRIVATE', voters: [alice.username, bob.email.toUpperCase()] });

    const asOwner = await request(app).get(`/api/polls/${poll.id}`).set(owner.auth).expect(200);
    expect(asOwner.body.data.poll.access).toBe('PRIVATE');
    expect(asOwner.body.data.poll.voters.map((v: { id: string }) => v.id).sort()).toEqual([alice.id, bob.id].sort());

    const asAlice = await request(app).get(`/api/polls/${poll.id}`).set(alice.auth).expect(200);
    expect(asAlice.body.data.poll.voters).toBeNull();
    expect(asAlice.body.data.poll.canVote).toBe(true);
  });

  it('lets invited voters vote and hides the poll from everyone else', async () => {
    const owner = await createUser();
    const invited = await createUser();
    const outsider = await createUser();
    const poll = await createPoll(owner, { access: 'PRIVATE', voters: [invited.username] });

    await request(app).post(`/api/polls/${poll.id}/votes`).set(invited.auth).send({ optionId: poll.options[0].id }).expect(201);

    await request(app).get(`/api/polls/${poll.id}`).set(outsider.auth).expect(404);
    await request(app).get(`/api/polls/${poll.id}/results`).set(outsider.auth).expect(404);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(outsider.auth).send({ optionId: poll.options[0].id }).expect(404);

    const outsiderList = await request(app).get('/api/polls').set(outsider.auth).expect(200);
    expect(outsiderList.body.data.polls).toHaveLength(0);
    expect(outsiderList.body.data.pagination.total).toBe(0);

    const invitedList = await request(app).get('/api/polls').set(invited.auth).expect(200);
    expect(invitedList.body.data.polls.map((p: { id: string }) => p.id)).toEqual([poll.id]);
  });

  it('lets admins see a private poll but not vote without an invitation', async () => {
    const owner = await createUser();
    const invited = await createUser();
    const admin = await createUser('admin');
    const poll = await createPoll(owner, { access: 'PRIVATE', voters: [invited.username] });

    const detail = await request(app).get(`/api/polls/${poll.id}`).set(admin.auth).expect(200);
    expect(detail.body.data.poll.canVote).toBe(false);
    const res = await request(app).post(`/api/polls/${poll.id}/votes`).set(admin.auth).send({ optionId: poll.options[0].id }).expect(403);
    expect(res.body.error.code).toBe('NOT_INVITED');
  });

  it('rejects unknown voters and the creator inviting themselves', async () => {
    const owner = await createUser();
    const base = { question: 'Question privée ?', options: ['Oui', 'Non'], endTime: new Date(Date.now() + 3600_000).toISOString(), access: 'PRIVATE' };

    const unknown = await request(app).post('/api/polls').set(owner.auth).send({ ...base, voters: ['nobody_here'] }).expect(400);
    expect(unknown.body.error.message).toContain('nobody_here');

    const self = await request(app).post('/api/polls').set(owner.auth).send({ ...base, voters: [owner.email] }).expect(400);
    expect(self.body.error.details[0].field).toBe('voters');
  });

  it('refuses to publish a private poll without any invited voter', async () => {
    const owner = await createUser();
    const draft = await createPoll(owner, { access: 'PRIVATE' }, { publish: false });
    const res = await request(app).post(`/api/polls/${draft.id}/publish`).set(owner.auth).expect(400);
    expect(res.body.error.code).toBe('NO_VOTERS');
  });

  it('updates the voters list of a draft, and clears it when switching back to public', async () => {
    const owner = await createUser();
    const first = await createUser();
    const second = await createUser();
    const draft = await createPoll(owner, { access: 'PRIVATE', voters: [first.username] }, { publish: false });

    const updated = await request(app).patch(`/api/polls/${draft.id}`).set(owner.auth).send({ voters: [second.username] }).expect(200);
    expect(updated.body.data.poll.voters.map((v: { id: string }) => v.id)).toEqual([second.id]);

    const madePublic = await request(app).patch(`/api/polls/${draft.id}`).set(owner.auth).send({ access: 'PUBLIC' }).expect(200);
    expect(madePublic.body.data.poll.access).toBe('PUBLIC');
    expect(madePublic.body.data.poll.voters).toBeNull();
  });

  it('looks users up by exact username or email without exposing the email', async () => {
    const me = await createUser();
    const other = await createUser();
    const byEmail = await request(app).get('/api/users/lookup').query({ identifier: other.email }).set(me.auth).expect(200);
    expect(byEmail.body.data.user).toEqual({ id: other.id, username: other.username });
    await request(app).get('/api/users/lookup').query({ identifier: 'user' }).set(me.auth).expect(404);
  });
});
