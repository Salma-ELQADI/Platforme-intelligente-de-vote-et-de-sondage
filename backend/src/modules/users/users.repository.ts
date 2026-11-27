import { query, Queryable, pool } from '../../db/pool';
import type { PublicUser, Role, UserPreferences, UserRow } from './users.types';

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    preferences: {
      locale: row.preferred_locale,
      theme: row.preferred_theme,
      messageNotifications: row.message_notifications,
    },
  };
}

export async function findUserById(id: string): Promise<PublicUser | null> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ? toPublicUser(rows[0]) : null;
}

/** Returns the full row, including the password hash: only for authentication code. */
export async function findUserRowById(id: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function findUserRowByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function insertUser(
  data: { username: string; email: string; passwordHash: string; role?: Role },
  db: Queryable = pool,
): Promise<PublicUser> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.username, data.email, data.passwordHash, data.role ?? 'user'],
  );
  return toPublicUser(rows[0]);
}

/** Partial update: only the provided columns are modified (COALESCE keeps the old value). */
export async function updateUser(
  id: string,
  data: { username?: string; email?: string; passwordHash?: string; role?: Role; isActive?: boolean },
): Promise<PublicUser | null> {
  const { rows } = await query<UserRow>(
    `UPDATE users SET
       username      = COALESCE($2, username),
       email         = COALESCE($3, email),
       password_hash = COALESCE($4, password_hash),
       role          = COALESCE($5, role),
       is_active     = COALESCE($6, is_active)
     WHERE id = $1
     RETURNING *`,
    [id, data.username ?? null, data.email ?? null, data.passwordHash ?? null, data.role ?? null, data.isActive ?? null],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

/** Partial update of the interface preferences. `locale: null` explicitly resets to "browser language". */
export async function updatePreferences(id: string, data: Partial<UserPreferences>): Promise<PublicUser | null> {
  const { rows } = await query<UserRow>(
    `UPDATE users SET
       preferred_locale      = CASE WHEN $2 THEN $3 ELSE preferred_locale END,
       preferred_theme       = COALESCE($4, preferred_theme),
       message_notifications = COALESCE($5, message_notifications)
     WHERE id = $1
     RETURNING *`,
    [id, data.locale !== undefined, data.locale ?? null, data.theme ?? null, data.messageNotifications ?? null],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

/**
 * Active users whose username starts with / contains `search`, for the
 * "new conversation" picker. Only id and username: emails are never listed.
 */
export async function searchDirectory(viewerId: string, search: string, limit: number) {
  const { rows } = await query<{ id: string; username: string }>(
    `SELECT id, username FROM users
      WHERE is_active AND id <> $1 AND username ILIKE $2
      ORDER BY (username ILIKE $3) DESC, lower(username)
      LIMIT $4`,
    [viewerId, `%${escapeLike(search)}%`, `${escapeLike(search)}%`, limit],
  );
  return rows;
}

/** Makes %, _ and \ literal inside an ILIKE pattern. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listUsers(opts: { limit: number; offset: number; search?: string }) {
  const params: unknown[] = [opts.limit, opts.offset];
  let where = '';
  if (opts.search) {
    params.push(`%${opts.search}%`);
    where = `WHERE username ILIKE $3 OR email ILIKE $3`;
  }
  const { rows } = await query<UserRow & { total: string }>(
    `SELECT *, COUNT(*) OVER() AS total FROM users ${where}
     ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    params,
  );
  return { users: rows.map(toPublicUser), total: rows[0] ? Number(rows[0].total) : 0 };
}

/**
 * Resolves a list of usernames and/or emails to active users.
 * Emails are matched case-insensitively (they are stored in lower case);
 * usernames are matched exactly. Returns, for each identifier, the user found (if any).
 */
export async function findActiveUsersByIdentifiers(identifiers: string[], db: Queryable = pool) {
  const { rows } = await db.query<{ identifier: string; id: string | null; username: string | null }>(
    `SELECT i.identifier, u.id, u.username
       FROM unnest($1::text[]) AS i(identifier)
       LEFT JOIN users u ON u.is_active AND (u.username = i.identifier OR u.email = lower(i.identifier))`,
    [identifiers],
  );
  return rows;
}
