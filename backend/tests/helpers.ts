import request from 'supertest';
import { createApp } from '../src/app';
import { pool, query } from '../src/db/pool';

export const app = createApp();

let counter = 0;

export async function resetDb() {
  await query('TRUNCATE notifications, votes, poll_options, polls, users RESTART IDENTITY CASCADE');
}

export interface TestUser {
  id: string;
  token: string;
  username: string;
  email: string;
  auth: { Authorization: string };
}

/** Registers a user through the real API and returns its JWT. */
export async function createUser(role: 'user' | 'admin' = 'user'): Promise<TestUser> {
  counter += 1;
  const username = `user${counter}_${Date.now() % 100000}`;
  const email = `${username}@test.local`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email, password: 'Password123', confirmPassword: 'Password123' })
    .expect(201);
  const { user, token } = res.body.data;
  if (role === 'admin') await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);
  return { id: user.id, token, username, email, auth: { Authorization: `Bearer ${token}` } };
}

export const inOneHour = () => new Date(Date.now() + 3600_000).toISOString();

export async function createPoll(
  owner: TestUser,
  overrides: Record<string, unknown> = {},
  { publish = true } = {},
) {
  const res = await request(app)
    .post('/api/polls')
    .set(owner.auth)
    .send({ question: 'Quel est votre langage préféré ?', options: ['TypeScript', 'Python', 'Go'], endTime: inOneHour(), ...overrides })
    .expect(201);
  let poll = res.body.data.poll;
  if (publish) {
    poll = (await request(app).post(`/api/polls/${poll.id}/publish`).set(owner.auth).expect(200)).body.data.poll;
  }
  return poll as { id: string; status: string; options: { id: string; text: string }[] };
}

/** Simulates time passing: moves a poll's end time into the past. */
export async function expirePoll(pollId: string) {
  await query(`UPDATE polls SET end_time = now() - interval '1 second' WHERE id = $1`, [pollId]);
}

export async function closeDb() {
  await pool.end();
}
