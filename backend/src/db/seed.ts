import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool, withTransaction } from './pool';
import { env } from '../config/env';

/**
 * Demo data for local development and the live presentation:
 *   admin@votelive.local / Admin1234
 *   alice@votelive.local / Alice1234
 *   bob@votelive.local   / Bob12345
 * plus two group conversations with a group poll each (a friends' group and
 * a work team), a direct conversation, and a few public polls.
 * Safe to run several times (existing users are kept).
 */
async function seed() {
  const users = [
    { username: 'admin', email: 'admin@votelive.local', password: 'Admin1234', role: 'admin' },
    { username: 'alice', email: 'alice@votelive.local', password: 'Alice1234', role: 'user' },
    { username: 'bob', email: 'bob@votelive.local', password: 'Bob12345', role: 'user' },
  ];

  await withTransaction(async (tx) => {
    const ids: Record<string, string> = {};
    for (const u of users) {
      const hash = await bcrypt.hash(u.password, env.BCRYPT_ROUNDS);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
        [u.username, u.email, hash, u.role],
      );
      ids[u.username] = rows[0].id;
    }

    await seedConversations(tx, ids);

    const { rows: existing } = await tx.query("SELECT 1 FROM polls WHERE access <> 'GROUP' LIMIT 1");
    if (existing.length) return;

    const polls = [
      { q: 'Quel langage préférez-vous pour le développement web ?', opts: ['JavaScript', 'Python', 'PHP', 'Java'], hours: 48, by: 'alice', vis: 'LIVE' },
      { q: 'Quel format de cours préférez-vous ?', opts: ['Présentiel', 'Distanciel', 'Hybride'], hours: 24, by: 'bob', vis: 'AFTER_CLOSE' },
    ];
    for (const p of polls) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO polls (question, created_by, status, results_visibility, end_time, published_at)
         VALUES ($1, $2, 'ACTIVE', $3, now() + make_interval(hours => $4), now()) RETURNING id`,
        [p.q, ids[p.by], p.vis, p.hours],
      );
      await tx.query(
        `INSERT INTO poll_options (poll_id, option_text, position)
         SELECT $1, t.text, t.pos FROM unnest($2::text[], $3::smallint[]) AS t(text, pos)`,
        [rows[0].id, p.opts, p.opts.map((_, i) => i)],
      );
    }
  });
  console.log('Seed completed. Demo accounts: admin / alice / bob (@votelive.local)');
}

/** Demo messaging: one direct conversation and two groups, each deciding something with a group poll. */
async function seedConversations(tx: PoolClient, ids: Record<string, string>) {
  const { rows: existing } = await tx.query('SELECT 1 FROM conversations LIMIT 1');
  if (existing.length) return;

  const say = async (conversationId: string, by: string, body: string, minutesAgo: number, pollId?: string) => {
    await tx.query(
      `INSERT INTO messages (conversation_id, sender_id, body, client_id, kind, poll_id, created_at)
       VALUES ($1, $2, $3, gen_random_uuid(), $4, $5, now() - make_interval(mins => $6))`,
      [conversationId, ids[by], body, pollId ? 'POLL' : 'TEXT', pollId ?? null, minutesAgo],
    );
    await tx.query('UPDATE conversations SET last_message_at = now() - make_interval(mins => $2) WHERE id = $1', [conversationId, minutesAgo]);
  };

  const pollFor = async (groupId: string, by: string, question: string, options: string[], hours: number) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO polls (question, created_by, status, results_visibility, access, group_id, end_time, published_at)
       VALUES ($1, $2, 'ACTIVE', 'LIVE', 'GROUP', $3, now() + make_interval(hours => $4), now()) RETURNING id`,
      [question, ids[by], groupId, hours],
    );
    await tx.query(
      `INSERT INTO poll_options (poll_id, option_text, position)
       SELECT $1, t.text, t.pos FROM unnest($2::text[], $3::smallint[]) AS t(text, pos)`,
      [rows[0].id, options, options.map((_, i) => i)],
    );
    return rows[0].id;
  };

  const group = async (name: string, admin: string, members: string[]) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO conversations (type, name, created_by) VALUES ('GROUP', $1, $2) RETURNING id`,
      [name, ids[admin]],
    );
    await tx.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role)
       SELECT $1, u, CASE WHEN u = $2 THEN 'ADMIN' ELSE 'MEMBER' END FROM unnest($3::uuid[]) AS u`,
      [rows[0].id, ids[admin], [admin, ...members].map((m) => ids[m])],
    );
    return rows[0].id;
  };

  // Friends deciding where to go this weekend.
  const friends = await group('Les amis du week-end', 'alice', ['bob']);
  await say(friends, 'alice', 'On fait quoi samedi ? Il paraît qu’il fera beau.', 50);
  await say(friends, 'bob', 'Je suis partant pour sortir de la ville !', 45);
  const weekend = await pollFor(friends, 'alice', 'Où allons-nous ce week-end ?', ['La plage à Bouznika', 'Randonnée à Ifrane', 'La médina de Fès'], 36);
  await say(friends, 'alice', 'Où allons-nous ce week-end ?', 40, weekend);

  // A work team deciding about the cafeteria.
  const team = await group('Équipe produit', 'bob', ['alice', 'admin']);
  await say(team, 'bob', 'La cafétéria est pleine tous les midis, on en parle à la direction ?', 30);
  const cafeteria = await pollFor(team, 'bob', 'La cafétéria doit-elle être agrandie ?', ['Oui, agrandir la salle', 'Non, mais ajouter des horaires', 'Non, elle suffit'], 72);
  await say(team, 'bob', 'La cafétéria doit-elle être agrandie ?', 25, cafeteria);

  // A private conversation.
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO conversations (type, created_by, direct_key) VALUES ('DIRECT', $1, $2) RETURNING id`,
    [ids.alice, ids.alice < ids.bob ? `${ids.alice}:${ids.bob}` : `${ids.bob}:${ids.alice}`],
  );
  await tx.query(`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, [rows[0].id, ids.alice, ids.bob]);
  await say(rows[0].id, 'alice', 'Salut Bob, tu as vu le sondage sur la cafétéria ?', 20);
  await say(rows[0].id, 'bob', 'Oui, j’ai voté pour les horaires décalés 😄', 15);

  // Authors have read their own messages.
  await tx.query(
    `UPDATE conversation_members m
        SET last_read_seq = COALESCE((SELECT MAX(seq) FROM messages x WHERE x.conversation_id = m.conversation_id AND x.sender_id = m.user_id), 0)`,
  );
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
