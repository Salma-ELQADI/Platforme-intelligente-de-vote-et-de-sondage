import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../src/db/pool';
import { app, closeDb, createUser, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

const valid = { username: 'salma', email: 'Salma@Example.com', password: 'Password123', confirmPassword: 'Password123' };

describe('Authentication', () => {
  it('registers a user, hashes the password and sets an httpOnly cookie', async () => {
    const res = await request(app).post('/api/auth/register').send(valid).expect(201);

    expect(res.body.data.user).toMatchObject({ username: 'salma', email: 'salma@example.com', role: 'user' });
    expect(res.body.data.user).not.toHaveProperty('password_hash');
    expect(res.headers['set-cookie'][0]).toMatch(/votelive_token=.+HttpOnly/i);

    const { rows } = await query('SELECT password_hash FROM users WHERE email = $1', ['salma@example.com']);
    expect(rows[0].password_hash).not.toBe('Password123');
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/); // bcrypt format
  });

  it('rejects invalid registration data with field-level details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'a', email: 'nope', password: 'short', confirmPassword: 'other' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['username', 'email', 'password']));
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    await request(app).post('/api/auth/register').send(valid).expect(201);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...valid, username: 'other', email: 'SALMA@example.com' })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with valid credentials', async () => {
    await request(app).post('/api/auth/register').send(valid).expect(201);
    const res = await request(app).post('/api/auth/login').send({ email: 'salma@example.com', password: 'Password123' }).expect(200);
    expect(res.body.data.token).toBeTypeOf('string');
  });

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    await request(app).post('/api/auth/register').send(valid).expect(201);
    const wrongPwd = await request(app).post('/api/auth/login').send({ email: valid.email, password: 'Wrong1234' }).expect(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'Wrong1234' }).expect(401);
    expect(wrongPwd.body.error).toEqual(unknown.body.error);
    expect(wrongPwd.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('logs in with the username as well as with the email', async () => {
    await request(app).post('/api/auth/register').send(valid).expect(201);
    const byName = await request(app).post('/api/auth/login').send({ identifier: valid.username, password: 'Password123' }).expect(200);
    expect(byName.body.data.user.email).toBe(valid.email.toLowerCase());
    await request(app).post('/api/auth/login').send({ identifier: valid.email.toUpperCase(), password: 'Password123' }).expect(200);
    const wrong = await request(app).post('/api/auth/login').send({ identifier: valid.username, password: 'Wrong1234' }).expect(401);
    const ghost = await request(app).post('/api/auth/login').send({ identifier: 'ghost_user', password: 'Wrong1234' }).expect(401);
    expect(wrong.body.error).toEqual(ghost.body.error); // no username enumeration
    await request(app).post('/api/auth/login').send({ password: 'Password123' }).expect(400);
  });

  it('refuses login for a deactivated account', async () => {
    const user = await createUser();
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'Password123' }).expect(403);
  });

  it('rejects unauthenticated and forged-token requests', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
  });

  it('accepts the session cookie and clears it on logout', async () => {
    const res = await request(app).post('/api/auth/register').send(valid).expect(201);
    const cookie = res.headers['set-cookie'];
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
    expect(out.headers['set-cookie'][0]).toMatch(/votelive_token=;/);
  });

  it('rejects a valid token of a user deactivated after login', async () => {
    const user = await createUser();
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
    await request(app).get('/api/auth/me').set(user.auth).expect(401);
  });
});

describe('Profile and role-based authorization', () => {
  it('updates the username without a password but requires it for a new password', async () => {
    const user = await createUser();
    await request(app).patch('/api/users/me').set(user.auth).send({ username: 'renamed' }).expect(200);
    await request(app).patch('/api/users/me').set(user.auth).send({ newPassword: 'NewPass123' }).expect(400);
    await request(app)
      .patch('/api/users/me')
      .set(user.auth)
      .send({ newPassword: 'NewPass123', currentPassword: 'Wrong1234' })
      .expect(401);
    await request(app)
      .patch('/api/users/me')
      .set(user.auth)
      .send({ newPassword: 'NewPass123', currentPassword: 'Password123' })
      .expect(200);
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'NewPass123' }).expect(200);
  });

  it('restricts user administration to admins', async () => {
    const user = await createUser();
    const admin = await createUser('admin');
    await request(app).get('/api/users').set(user.auth).expect(403);
    const res = await request(app).get('/api/users').set(admin.auth).expect(200);
    expect(res.body.data.pagination.total).toBe(2);
    await request(app).patch(`/api/users/${user.id}`).set(admin.auth).send({ role: 'admin' }).expect(200);
    await request(app).patch(`/api/users/${admin.id}`).set(admin.auth).send({ isActive: false }).expect(400);
  });
});
