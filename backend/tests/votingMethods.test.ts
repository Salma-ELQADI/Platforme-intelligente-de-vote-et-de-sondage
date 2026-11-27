import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../src/db/pool';
import { instantRunoff } from '../src/modules/polls/rankedChoice';
import { activateScheduledPolls, closeExpiredPolls, sendDueReminders } from '../src/modules/polls/polls.service';
import { app, closeDb, createUser, expirePoll, inOneHour, resetDb, type TestUser } from './helpers';

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());
afterAll(closeDb);

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function newPoll(owner: TestUser, overrides: Record<string, unknown>, { publish = true } = {}) {
  const res = await request(app)
    .post('/api/polls')
    .set(owner.auth)
    .send({ question: 'Où allons-nous ce week-end ?', options: ['Plage', 'Montagne', 'Médina', 'Cinéma'], endTime: inOneHour(), ...overrides });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  let poll = res.body.data.poll;
  if (publish) poll = (await request(app).post(`/api/polls/${poll.id}/publish`).set(owner.auth).expect(200)).body.data.poll;
  return poll as { id: string; status: string; options: { id: string; text: string }[]; votingMethod: string; maxChoices: number | null };
}

const vote = (user: TestUser, pollId: string, optionIds: string[]) =>
  request(app).post(`/api/polls/${pollId}/votes`).set(user.auth).send({ optionIds });

describe('Instant-runoff count (unit)', () => {
  it('elects a majority winner in the first round', () => {
    const r = instantRunoff(['a', 'b', 'c'], [['a'], ['a', 'b'], ['b'], ['a', 'c']]);
    expect(r.winners).toEqual(['a']);
    expect(r.rounds).toHaveLength(1);
  });

  it('transfers the votes of the eliminated option to the next preference', () => {
    // First preferences: A 4, B 3, C 2 → no majority (5 needed of 9); C eliminated, its ballots go to B → B 5 wins.
    const ballots = [
      ...Array(4).fill(['A', 'B']),
      ...Array(3).fill(['B', 'A']),
      ...Array(2).fill(['C', 'B']),
    ];
    const r = instantRunoff(['A', 'B', 'C'], ballots);
    expect(r.rounds[0].eliminated).toEqual(['C']);
    expect(r.rounds[1].tallies).toEqual(expect.arrayContaining([{ optionId: 'B', votes: 5 }, { optionId: 'A', votes: 4 }]));
    expect(r.winners).toEqual(['B']);
  });

  it('settles an all-way tie with second preferences instead of declaring a tie', () => {
    // One first choice each; C is mentioned least, so it goes first; its ballot then elects A.
    const r = instantRunoff(['A', 'B', 'C'], [['A', 'B'], ['B', 'A'], ['C', 'A']]);
    expect(r.rounds[0].eliminated).toEqual(['C']);
    expect(r.winners).toEqual(['A']);
  });

  it('handles exhausted ballots and perfect ties', () => {
    const exhausted = instantRunoff(['A', 'B', 'C'], [['A'], ['A'], ['B'], ['B'], ['C']]);
    // C eliminated, its ballot has no next choice: 4 ballots remain, A and B tied → shared victory.
    expect(exhausted.rounds.at(-1)!.exhaustedBallots).toBe(1);
    expect(exhausted.winners.sort()).toEqual(['A', 'B']);
    expect(instantRunoff(['A', 'B'], [])).toEqual({ rounds: [], winners: [] });
  });
});

describe('Multiple-choice polls', () => {
  it('accepts up to maxChoices answers and reports the share of voters', async () => {
    const owner = await createUser();
    const [u1, u2] = [await createUser(), await createUser()];
    const poll = await newPoll(owner, { votingMethod: 'MULTIPLE', maxChoices: 2 });
    expect(poll).toMatchObject({ votingMethod: 'MULTIPLE', maxChoices: 2 });
    const [a, b, c] = poll.options.map((o) => o.id);

    await vote(u1, poll.id, [a, b]).expect(201);
    await vote(u2, poll.id, [a]).expect(201);
    const tooMany = await vote(owner, poll.id, [a, b, c]);
    expect(tooMany.status).toBe(403); // the author of a public poll still cannot vote

    const u3 = await createUser();
    expect((await vote(u3, poll.id, [a, b, c])).body.error.code).toBe('INVALID_CHOICES');
    expect((await vote(u3, poll.id, [a, a])).body.error.code).toBe('INVALID_CHOICES');
    await vote(u1, poll.id, [c]).expect(409); // one ballot per person, whatever the method

    const results = (await request(app).get(`/api/polls/${poll.id}/results`).set(u1.auth)).body.data.results;
    expect(results).toMatchObject({ method: 'MULTIPLE', totalVotes: 2 });
    expect(results.options[0]).toMatchObject({ votes: 2, percentage: 100 }); // both voters chose A
    expect(results.options[1]).toMatchObject({ votes: 1, percentage: 50 });

    const me = (await request(app).get(`/api/polls/${poll.id}`).set(u1.auth)).body.data.poll;
    expect(me.myChoices).toEqual([a, b]);
  });

  it('validates maxChoices at creation', async () => {
    const owner = await createUser();
    const base = { question: 'Quels jours vous conviennent ?', options: ['Lundi', 'Mardi'], endTime: inOneHour() };
    await request(app).post('/api/polls').set(owner.auth).send({ ...base, votingMethod: 'MULTIPLE' }).expect(400);
    await request(app).post('/api/polls').set(owner.auth).send({ ...base, votingMethod: 'MULTIPLE', maxChoices: 3 }).expect(400);
  });
});

describe('Ranked-choice polls', () => {
  it('counts ranked ballots by instant runoff and keeps the order of each ballot', async () => {
    const owner = await createUser();
    const poll = await newPoll(owner, { votingMethod: 'RANKED', options: ['Plage', 'Montagne', 'Médina'] });
    const [plage, montagne, medina] = poll.options.map((o) => o.id);
    const voters = await Promise.all(Array.from({ length: 5 }, () => createUser()));
    // First preferences: Plage 2, Montagne 2, Médina 1 → Médina eliminated, its ballot goes to Montagne (3/5).
    await vote(voters[0], poll.id, [plage, montagne]).expect(201);
    await vote(voters[1], poll.id, [plage]).expect(201); // partial ranking is allowed
    await vote(voters[2], poll.id, [montagne, plage]).expect(201);
    await vote(voters[3], poll.id, [montagne, medina, plage]).expect(201);
    await vote(voters[4], poll.id, [medina, montagne]).expect(201);

    const results = (await request(app).get(`/api/polls/${poll.id}/results`).set(owner.auth)).body.data.results;
    expect(results.method).toBe('RANKED');
    expect(results.options.map((o: { votes: number }) => o.votes)).toEqual([2, 2, 1]); // first preferences
    expect(results.rounds).toHaveLength(2);
    expect(results.rounds[0].eliminated).toEqual([medina]);
    expect(results.winners).toEqual([montagne]);

    const history = (await request(app).get('/api/votes/me').set(voters[3].auth)).body.data.votes[0];
    expect(history.choices.map((c: { id: string }) => c.id)).toEqual([montagne, medina, plage]);
  });

  it('still accepts the legacy { optionId } body for single-choice polls', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await newPoll(owner, {});
    await request(app).post(`/api/polls/${poll.id}/votes`).set(voter.auth).send({ optionId: poll.options[0].id }).expect(201);
    expect((await vote(await createUser(), poll.id, poll.options.slice(0, 2).map((o) => o.id))).body.error.code).toBe('INVALID_CHOICES');
  });
});

describe('Scheduled polls and reminders', () => {
  it('publishes a future poll as SCHEDULED, hides it, then opens it on time', async () => {
    const owner = await createUser();
    const other = await createUser();
    const poll = await newPoll(owner, { startsAt: inMinutes(30), endTime: inMinutes(120) });
    expect(poll.status).toBe('SCHEDULED');

    await request(app).get(`/api/polls/${poll.id}`).set(other.auth).expect(404);
    expect((await vote(owner, poll.id, [poll.options[0].id])).body.error.code).toBe('POLL_NOT_STARTED');
    expect((await request(app).get('/api/polls/mine?status=SCHEDULED').set(owner.auth)).body.data.polls).toHaveLength(1);

    await query(`UPDATE polls SET starts_at = now() - interval '1 second' WHERE id = $1`, [poll.id]);
    expect(await activateScheduledPolls()).toEqual([poll.id]);
    expect(await activateScheduledPolls()).toEqual([]); // idempotent
    const opened = (await request(app).get(`/api/polls/${poll.id}`).set(other.auth).expect(200)).body.data.poll;
    expect(opened.status).toBe('ACTIVE');
    await vote(other, poll.id, [poll.options[0].id]).expect(201);
  });

  it('validates the schedule and lets the author take a scheduled poll back to draft', async () => {
    const owner = await createUser();
    const bad = await request(app)
      .post('/api/polls')
      .set(owner.auth)
      .send({ question: 'Une question programmée ?', options: ['Oui', 'Non'], startsAt: inMinutes(90), endTime: inMinutes(60) });
    expect(bad.status).toBe(400);

    const poll = await newPoll(owner, { startsAt: inMinutes(30), endTime: inMinutes(120) });
    const back = await request(app).post(`/api/polls/${poll.id}/unschedule`).set(owner.auth).expect(200);
    expect(back.body.data.poll.status).toBe('DRAFT');
    await request(app).delete(`/api/polls/${poll.id}`).set(owner.auth).expect(204);
  });

  it('notifies invited voters when a private poll opens, and reminds only those who have not voted, once', async () => {
    const owner = await createUser();
    const [voted, late] = [await createUser(), await createUser()];
    const poll = await newPoll(owner, { access: 'PRIVATE', voters: [voted.username, late.username], remindBeforeMinutes: 30, endTime: inMinutes(120) });

    const openedFor = await query(`SELECT user_id FROM notifications WHERE poll_id = $1 AND type = 'POLL_OPENED'`, [poll.id]);
    expect(openedFor.rows.map((r) => r.user_id).sort()).toEqual([voted.id, late.id].sort());

    await vote(voted, poll.id, [poll.options[0].id]).expect(201);
    expect(await sendDueReminders()).toEqual([]); // not due yet
    await query(`UPDATE polls SET end_time = now() + interval '10 minutes' WHERE id = $1`, [poll.id]);
    expect(await sendDueReminders()).toEqual([poll.id]);
    expect(await sendDueReminders()).toEqual([]); // sent once

    const reminded = await query(`SELECT user_id FROM notifications WHERE poll_id = $1 AND type = 'POLL_REMINDER'`, [poll.id]);
    expect(reminded.rows.map((r) => r.user_id)).toEqual([late.id]);
  });

  it('refuses reminders on public polls and reminders longer than the poll', async () => {
    const owner = await createUser();
    const base = { question: 'Un sondage public ?', options: ['Oui', 'Non'], endTime: inOneHour() };
    await request(app).post('/api/polls').set(owner.auth).send({ ...base, remindBeforeMinutes: 30 }).expect(400);
    const invitee = await createUser();
    const draft = await newPoll(owner, { access: 'PRIVATE', voters: [invitee.username], remindBeforeMinutes: 120, endTime: inMinutes(60) }, { publish: false });
    const res = await request(app).post(`/api/polls/${draft.id}/publish`).set(owner.auth);
    expect(res.body.error.code).toBe('INVALID_REMINDER');
  });
});

describe('AI summary of closed polls', () => {
  const mockOpenRouter = (summary: string) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ model: 'test/model', choices: [{ message: { content: JSON.stringify({ summary }) } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('summarises a closed poll once per language and serves it from the cache', async () => {
    const owner = await createUser();
    const voter = await createUser();
    const poll = await newPoll(owner, {});
    await vote(voter, poll.id, [poll.options[1].id]).expect(201);

    const early = await request(app).get(`/api/polls/${poll.id}/summary?locale=fr`).set(voter.auth);
    expect(early.body.error.code).toBe('POLL_NOT_CLOSED');

    await expirePoll(poll.id);
    await closeExpiredPolls();
    const fetchMock = mockOpenRouter('La montagne l’emporte avec 100 % des voix, sur un seul bulletin exprimé.');

    const first = await request(app).get(`/api/polls/${poll.id}/summary?locale=fr`).set(voter.auth).expect(200);
    expect(first.body.data.summary).toMatchObject({ locale: 'fr', summary: expect.stringContaining('montagne') });
    // The figures sent to the model come from the database.
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.messages[1].content).toContain('Ballots cast: 1');
    expect(sent.messages[0].content).toContain('French');

    await request(app).get(`/api/polls/${poll.id}/summary?locale=fr`).set(owner.auth).expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached

    mockOpenRouter('The mountain wins with 100% of the votes, from a single ballot cast in total.');
    const en = await request(app).get(`/api/polls/${poll.id}/summary?locale=en`).set(voter.auth).expect(200);
    expect(en.body.data.summary.locale).toBe('en');
  });

  it('follows the poll visibility and refuses polls without votes', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const invitee = await createUser();
    const poll = await newPoll(owner, { access: 'PRIVATE', voters: [invitee.username] });
    await expirePoll(poll.id);
    await closeExpiredPolls();
    await request(app).get(`/api/polls/${poll.id}/summary`).set(stranger.auth).expect(404);
    expect((await request(app).get(`/api/polls/${poll.id}/summary`).set(owner.auth)).body.error.code).toBe('NO_VOTES');
  });
});
