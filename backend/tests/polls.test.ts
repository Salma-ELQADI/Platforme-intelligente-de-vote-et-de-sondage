import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';
import { app, closeDb, createPoll, createUser, inOneHour, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

describe('Poll creation', () => {
  it('creates a DRAFT poll with ordered options', async () => {
    const owner = await createUser();
    const res = await request(app)
      .post('/api/polls')
      .set(owner.auth)
      .send({ question: '  Quel framework frontend ?  ', options: ['React', 'Vue', 'Angular'], endTime: inOneHour() })
      .expect(201);
    const poll = res.body.data.poll;
    expect(poll).toMatchObject({ question: 'Quel framework frontend ?', status: 'DRAFT', creationMode: 'MANUAL', totalVotes: 0 });
    expect(poll.options.map((o: { text: string }) => o.text)).toEqual(['React', 'Vue', 'Angular']);
  });

  it.each([
    ['a single option', { options: ['Seul'] }],
    ['duplicate options', { options: ['Oui', 'oui'] }],
    ['a past end time', { endTime: new Date(Date.now() - 60_000).toISOString() }],
    ['a too short question', { question: 'Ok?' }],
    ['more than 10 options', { options: Array.from({ length: 11 }, (_, i) => `Option ${i}`) }],
  ])('rejects %s', async (_label, override) => {
    const owner = await createUser();
    const res = await request(app)
      .post('/api/polls')
      .set(owner.auth)
      .send({ question: 'Question valide ?', options: ['A', 'B'], endTime: inOneHour(), ...override })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    await request(app).post('/api/polls').send({ question: 'Question ?', options: ['A', 'B'], endTime: inOneHour() }).expect(401);
  });
});

describe('Poll lifecycle and ownership', () => {
  it('keeps drafts private to their owner', async () => {
    const owner = await createUser();
    const other = await createUser();
    const draft = await createPoll(owner, {}, { publish: false });
    await request(app).get(`/api/polls/${draft.id}`).set(owner.auth).expect(200);
    await request(app).get(`/api/polls/${draft.id}`).set(other.auth).expect(404);
  });

  it('forbids another user from modifying a poll', async () => {
    const owner = await createUser();
    const other = await createUser();
    const poll = await createPoll(owner, {}, { publish: false });
    await query(`UPDATE polls SET status = 'ACTIVE', published_at = now() WHERE id = $1`, [poll.id]); // make it visible
    const res = await request(app).post(`/api/polls/${poll.id}/close`).set(other.auth).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('edits a draft, including replacing its options', async () => {
    const owner = await createUser();
    const poll = await createPoll(owner, {}, { publish: false });
    const res = await request(app)
      .patch(`/api/polls/${poll.id}`)
      .set(owner.auth)
      .send({ question: 'Question modifiée ?', options: ['X', 'Y'], description: 'Contexte' })
      .expect(200);
    expect(res.body.data.poll).toMatchObject({ question: 'Question modifiée ?', description: 'Contexte' });
    expect(res.body.data.poll.options).toHaveLength(2);
  });

  it('publishes a draft (DRAFT → ACTIVE) only once', async () => {
    const owner = await createUser();
    const draft = await createPoll(owner, {}, { publish: false });
    const res = await request(app).post(`/api/polls/${draft.id}/publish`).set(owner.auth).expect(200);
    expect(res.body.data.poll).toMatchObject({ status: 'ACTIVE', isOpen: true });
    expect(res.body.data.poll.publishedAt).not.toBeNull();
    const again = await request(app).post(`/api/polls/${draft.id}/publish`).set(owner.auth).expect(409);
    expect(again.body.error.code).toBe('POLL_ALREADY_PUBLISHED');
  });

  it('refuses to publish a draft whose end time has passed', async () => {
    const owner = await createUser();
    const draft = await createPoll(owner, {}, { publish: false });
    await query(`UPDATE polls SET end_time = now() - interval '1 hour' WHERE id = $1`, [draft.id]);
    const res = await request(app).post(`/api/polls/${draft.id}/publish`).set(owner.auth).expect(400);
    expect(res.body.error.code).toBe('INVALID_END_TIME');
  });

  it('refuses to edit a published poll', async () => {
    const owner = await createUser();
    const poll = await createPoll(owner);
    const res = await request(app).patch(`/api/polls/${poll.id}`).set(owner.auth).send({ question: 'Nouvelle question ?' }).expect(409);
    expect(res.body.error.code).toBe('POLL_NOT_EDITABLE');
  });

  it('closes an active poll manually (ACTIVE → CLOSED)', async () => {
    const owner = await createUser();
    const poll = await createPoll(owner);
    const res = await request(app).post(`/api/polls/${poll.id}/close`).set(owner.auth).expect(200);
    expect(res.body.data.poll).toMatchObject({ status: 'CLOSED', isOpen: false });
    await request(app).post(`/api/polls/${poll.id}/close`).set(owner.auth).expect(409);
  });

  it('lets owners delete drafts, and only admins delete published polls', async () => {
    const owner = await createUser();
    const admin = await createUser('admin');
    const draft = await createPoll(owner, {}, { publish: false });
    await request(app).delete(`/api/polls/${draft.id}`).set(owner.auth).expect(204);
    const active = await createPoll(owner);
    await request(app).delete(`/api/polls/${active.id}`).set(owner.auth).expect(409);
    await request(app).delete(`/api/polls/${active.id}`).set(admin.auth).expect(204);
  });

  it('lists active polls publicly and drafts only in "mine"', async () => {
    const owner = await createUser();
    const viewer = await createUser();
    await createPoll(owner, { question: 'Sondage publié ?' });
    await createPoll(owner, { question: 'Brouillon caché ?' }, { publish: false });

    const list = await request(app).get('/api/polls?status=ACTIVE').set(viewer.auth).expect(200);
    expect(list.body.data.polls.map((p: { question: string }) => p.question)).toEqual(['Sondage publié ?']);

    const mine = await request(app).get('/api/polls/mine').set(owner.auth).expect(200);
    expect(mine.body.data.polls).toHaveLength(2);
  });

  it('returns 400 for a malformed poll id', async () => {
    const user = await createUser();
    await request(app).get('/api/polls/not-a-uuid').set(user.auth).expect(400);
  });
});
