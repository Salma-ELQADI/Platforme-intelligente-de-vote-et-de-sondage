import bcrypt from 'bcryptjs';
import { pool, withTransaction } from './pool';
import { env } from '../config/env';

/**
 * Demo data for local development and the live presentation:
 *   admin@votelive.local / Admin1234
 *   alice@votelive.local / Alice1234
 *   bob@votelive.local   / Bob12345
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

    const { rows: existing } = await tx.query('SELECT 1 FROM polls LIMIT 1');
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

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
