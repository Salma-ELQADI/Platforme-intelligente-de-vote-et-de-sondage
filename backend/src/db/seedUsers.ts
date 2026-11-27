import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { env } from '../config/env';

/**
 * Creates many fake users sharing one password, for local testing.
 *   npm run seed:users            -> 50 users
 *   npm run seed:users -- 200     -> 200 users
 * Emails: <firstname>.<lastname><n>@votelive.local. Safe to re-run (existing emails are skipped).
 */
const PASSWORD = 'b.bouchikhi1';

const FIRST = [
  'youssef', 'fatima', 'mohamed', 'khadija', 'omar', 'salma', 'hamza', 'meryem', 'amine', 'sara',
  'yassine', 'imane', 'karim', 'nadia', 'mehdi', 'hiba', 'ayoub', 'zineb', 'reda', 'leila',
  'adam', 'lina', 'ilyas', 'ines', 'anas', 'chaima', 'bilal', 'aya', 'soufiane', 'houda',
];
const LAST = [
  'alaoui', 'bennani', 'tazi', 'idrissi', 'berrada', 'chraibi', 'fassi', 'elamrani', 'benjelloun', 'lahlou',
  'naciri', 'sqalli', 'kettani', 'ouazzani', 'filali', 'zahiri', 'mansouri', 'haddad', 'rami', 'saidi',
];

async function seedUsers() {
  const count = Math.max(1, Number(process.argv[2]) || 50);
  const hash = await bcrypt.hash(PASSWORD, env.BCRYPT_ROUNDS);

  const usernames: string[] = [];
  const emails: string[] = [];
  for (let i = 0; i < count; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
    const n = i + 1;
    usernames.push(`${first}.${last}${n}`.slice(0, 30));
    emails.push(`${first}.${last}${n}@votelive.local`);
  }

  const { rowCount } = await pool.query(
    `INSERT INTO users (username, email, password_hash, role)
     SELECT u, e, $3, 'user' FROM unnest($1::text[], $2::text[]) AS t(u, e)
     ON CONFLICT DO NOTHING`,
    [usernames, emails, hash],
  );

  console.log(`Created ${rowCount} fake users (${count - (rowCount ?? 0)} already existed). Password: ${PASSWORD}`);
  console.log(`Example login: ${emails[0]}`);
}

seedUsers()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
