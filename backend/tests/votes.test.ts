import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';
import { app, closeDb, createPoll, createUser, expirePoll, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

describe('Voting', () => {
  it('records a vote and returns results computed from the database', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner);
    const res = await request(app)
      .post(`/api/polls/${poll.id}/votes`)
      .set(voter.auth)
      .send({ optionId: poll.options[1].id })
      .expect(201);

    expect(res.body.data.vote.optionId).toBe(poll.options[1].id);
    expect(res.body.data.results.totalVotes).toBe(1);
    expect(res.body.data.results.options[1]).toMatchObject({ votes: 1, percentage: 100 });

    const detail = await request(app).get(`/api/polls/${poll.id}`).set(voter.auth).expect(200);
    expect(detail.body.data.poll.myVoteOptionId).toBe(poll.options[1].id);
  });

  it('rejects a second vote from the same user (409)', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[0].id }).expect(201);
    const res = await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[1].id }).expect(409);
    expect(res.body.error.code).toBe('ALREADY_VOTED');
  });

  it('rejects a vote after the end time even before the scheduler has closed the poll', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner);
    await expirePoll(poll.id); // status is still ACTIVE in the database
    const res = await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[0].id }).expect(403);
    expect(res.body.error.code).toBe('POLL_CLOSED');
  });

  it('rejects a vote on a closed poll', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner);
    await request(app).post(`/api/polls/${poll.id}/close`).set(owner.auth).expect(200);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[0].id }).expect(403);
  });

  it('rejects a vote on a draft as if it did not exist', async () => {
    const owner = await createUser();
    const draft = await createPoll(owner, {}, { publish: false });
    await request(app).post(`/api/polls/${draft.id}/votes`).set(owner.auth).send({ optionId: draft.options[0].id }).expect(404);
  });

  it('rejects an option that belongs to another poll', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const pollA = await createPoll(owner);
    const pollB = await createPoll(owner, { question: 'Autre sondage ?' });
    const res = await request(app).post(`/api/polls/${pollA.id}/votes`).set(voter.auth).send({ optionId: pollB.options[0].id }).expect(400);
    expect(res.body.error.code).toBe('INVALID_OPTION');
  });

  it('rejects a vote without authentication', async () => {
    const owner = await createUser();
    const poll = await createPoll(owner);
    await request(app).post(`/api/polls/${poll.id}/votes`).send({ optionId: poll.options[0].id }).expect(401);
  });

  it('accepts exactly one vote when the same user sends 10 votes concurrently', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[i % 3].id }),
      ),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);

    const { rows } = await query('SELECT COUNT(*)::int AS n FROM votes WHERE poll_id = $1', [poll.id]);
    expect(rows[0].n).toBe(1);
  });

  it('counts every vote when many different users vote concurrently', async () => {
    const owner = await createUser();
    const poll = await createPoll(owner);
    const voters = await Promise.all(Array.from({ length: 8 }, () => createUser()));
    await Promise.all(
      voters.map((v, i) => request(app).post(`/api/polls/${poll.id}/votes`).set(v.auth).send({ optionId: poll.options[i % 2].id }).expect(201)),
    );
    const res = await request(app).get(`/api/polls/${poll.id}/results`).set(owner.auth).expect(200);
    expect(res.body.data.results.totalVotes).toBe(8);
    expect(res.body.data.results.options.map((o: { votes: number }) => o.votes)).toEqual([4, 4, 0]);
    expect(res.body.data.results.options.map((o: { percentage: number }) => o.percentage)).toEqual([50, 50, 0]);
  });

  it('is protected at database level: a vote cannot reference an option of another poll', async () => {
    const owner = await createUser();
    const pollA = await createPoll(owner);
    const pollB = await createPoll(owner, { question: 'Autre sondage ?' });
    await expect(
      query('INSERT INTO votes (poll_id, user_id, option_id) VALUES ($1, $2, $3)', [pollA.id, owner.id, pollB.options[0].id]),
    ).rejects.toMatchObject({ code: '23503', constraint: 'votes_option_belongs_to_poll' });
  });

  it('is protected at database level: UNIQUE (poll_id, user_id)', async () => {
    const owner = await createUser();
    const poll = await createPoll(owner);
    const insert = () =>
      query('INSERT INTO votes (poll_id, user_id, option_id) VALUES ($1, $2, $3)', [poll.id, owner.id, poll.options[0].id]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505', constraint: 'votes_one_per_user_per_poll' });
  });

  it('hides per-option results of AFTER_CLOSE polls until closure (except for the creator)', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner, { resultsVisibility: 'AFTER_CLOSE' });
    const vote = await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[0].id }).expect(201);
    expect(vote.body.data.results).toMatchObject({ visible: false, totalVotes: 1, options: [] });

    const ownerView = await request(app).get(`/api/polls/${poll.id}/results`).set(owner.auth).expect(200);
    expect(ownerView.body.data.results.visible).toBe(true);

    await request(app).post(`/api/polls/${poll.id}/close`).set(owner.auth).expect(200);
    const final = await request(app).get(`/api/polls/${poll.id}/results`).set(voter.auth).expect(200);
    expect(final.body.data.results).toMatchObject({ visible: true, status: 'CLOSED' });
    expect(final.body.data.results.options[0].votes).toBe(1);
  });

  it('returns the voting history of the current user', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await createPoll(owner);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[2].id }).expect(201);
    const res = await request(app).get('/api/votes/me').set(voter.auth).expect(200);
    expect(res.body.data.votes).toHaveLength(1);
    expect(res.body.data.votes[0].option.text).toBe('Go');
  });
});
