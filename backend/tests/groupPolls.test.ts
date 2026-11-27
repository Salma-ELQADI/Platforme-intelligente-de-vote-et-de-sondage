import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, closeDb, createUser, inOneHour, resetDb, type TestUser } from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

async function createGroup(owner: TestUser, members: TestUser[], name = 'Les amis') {
  const res = await request(app)
    .post('/api/conversations/groups')
    .set(owner.auth)
    .send({ name, memberIds: members.map((m) => m.id) })
    .expect(201);
  return res.body.data.conversation as { id: string };
}

async function createGroupPoll(owner: TestUser, groupId: string, { publish = true } = {}) {
  const res = await request(app)
    .post('/api/polls')
    .set(owner.auth)
    .send({ question: 'Où allons-nous ce week-end ?', options: ['La plage', 'La montagne', 'Le cinéma'], endTime: inOneHour(), access: 'GROUP', groupId })
    .expect(201);
  let poll = res.body.data.poll;
  if (publish) poll = (await request(app).post(`/api/polls/${poll.id}/publish`).set(owner.auth).expect(200)).body.data.poll;
  return poll as { id: string; access: string; group: { id: string; name: string }; options: { id: string }[]; canVote: boolean };
}

describe('Group polls', () => {
  it('is addressed to a group the author belongs to', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const stranger = await createUser();
    const group = await createGroup(owner, [friend]);

    const poll = await createGroupPoll(owner, group.id);
    expect(poll).toMatchObject({ access: 'GROUP', group: { id: group.id, name: 'Les amis' } });

    const base = { question: 'Une question de groupe ?', options: ['Oui', 'Non'], endTime: inOneHour(), access: 'GROUP' };
    await request(app).post('/api/polls').set(owner.auth).send(base).expect(400); // no group
    const res = await request(app).post('/api/polls').set(stranger.auth).send({ ...base, groupId: group.id }).expect(400);
    expect(res.body.error.code).toBe('NOT_GROUP_MEMBER');
  });

  it('is visible and votable by members only, author included', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const stranger = await createUser();
    const group = await createGroup(owner, [friend]);
    const poll = await createGroupPoll(owner, group.id);

    // Members see it in the main list; strangers do not even know it exists.
    const list = await request(app).get('/api/polls?status=ACTIVE').set(friend.auth);
    expect(list.body.data.polls.map((p: { id: string }) => p.id)).toContain(poll.id);
    const strangerList = await request(app).get('/api/polls?status=ACTIVE').set(stranger.auth);
    expect(strangerList.body.data.polls).toHaveLength(0);
    await request(app).get(`/api/polls/${poll.id}`).set(stranger.auth).expect(404);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(stranger.auth).send({ optionId: poll.options[0].id }).expect(404);

    // A group decision: the author votes like everyone else.
    expect(poll.canVote).toBe(true);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(owner.auth).send({ optionId: poll.options[0].id }).expect(201);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(friend.auth).send({ optionId: poll.options[1].id }).expect(201);
    const results = await request(app).get(`/api/polls/${poll.id}/results`).set(friend.auth);
    expect(results.body.data.results.totalVotes).toBe(2);
  });

  it('is announced in the group chat once, when published', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const group = await createGroup(owner, [friend]);
    const draft = await createGroupPoll(owner, group.id, { publish: false });

    let history = await request(app).get(`/api/conversations/${group.id}/messages`).set(friend.auth);
    expect(history.body.data.messages).toHaveLength(0); // drafts are not announced

    await request(app).post(`/api/polls/${draft.id}/publish`).set(owner.auth).expect(200);
    history = await request(app).get(`/api/conversations/${group.id}/messages`).set(friend.auth);
    expect(history.body.data.messages).toHaveLength(1);
    expect(history.body.data.messages[0]).toMatchObject({
      kind: 'POLL',
      sender: { id: owner.id },
      poll: { id: draft.id, question: 'Où allons-nous ce week-end ?', status: 'ACTIVE', optionCount: 3 },
    });
    const conv = await request(app).get(`/api/conversations/${group.id}`).set(friend.auth);
    expect(conv.body.data.conversation.unreadCount).toBe(1);

    const polls = await request(app).get(`/api/conversations/${group.id}/polls`).set(friend.auth).expect(200);
    expect(polls.body.data.polls.map((p: { id: string }) => p.id)).toEqual([draft.id]);
  });

  it('removed members lose access to the group polls', async () => {
    const owner = await createUser();
    const friend = await createUser();
    const group = await createGroup(owner, [friend]);
    const poll = await createGroupPoll(owner, group.id);
    await request(app).get(`/api/polls/${poll.id}`).set(friend.auth).expect(200);

    await request(app).delete(`/api/conversations/${group.id}/members/${friend.id}`).set(owner.auth).expect(200);
    await request(app).get(`/api/polls/${poll.id}`).set(friend.auth).expect(404);
    await request(app).post(`/api/polls/${poll.id}/votes`).set(friend.auth).send({ optionId: poll.options[0].id }).expect(404);
    await request(app).get(`/api/conversations/${group.id}/polls`).set(friend.auth).expect(404);
  });

  it('keeps public and private polls unchanged: authors still cannot vote there', async () => {
    const owner = await createUser();
    const res = await request(app)
      .post('/api/polls')
      .set(owner.auth)
      .send({ question: 'La cafétéria doit-elle être agrandie ?', options: ['Oui', 'Non'], endTime: inOneHour() })
      .expect(201);
    const poll = (await request(app).post(`/api/polls/${res.body.data.poll.id}/publish`).set(owner.auth)).body.data.poll;
    expect(poll.group).toBeNull();
    const vote = await request(app).post(`/api/polls/${poll.id}/votes`).set(owner.auth).send({ optionId: poll.options[0].id });
    expect(vote.body.error.code).toBe('OWNER_CANNOT_VOTE');
  });
});
