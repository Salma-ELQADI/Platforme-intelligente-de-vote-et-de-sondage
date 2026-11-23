import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { AppError, conflict, isPgError, PG_ERRORS } from '../../utils/errors';
import { findUserRowByEmail, insertUser, toPublicUser } from '../users/users.repository';
import type { PublicUser } from '../users/users.types';
import { signToken } from './auth.tokens';
import type { LoginInput, RegisterInput } from './auth.schemas';

// A valid bcrypt hash used to keep the response time constant when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('timing-attack-protection', 10);

export function hashPassword(password: string) {
  // bcrypt generates a random salt and stores it inside the resulting hash.
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

/** Translates a UNIQUE violation on users into a readable 409 error. */
export function mapUserUniqueViolation(err: unknown): never {
  if (isPgError(err, PG_ERRORS.UNIQUE_VIOLATION)) {
    if (err.constraint === 'users_email_unique') throw conflict('EMAIL_TAKEN', 'Cet email est déjà utilisé');
    if (err.constraint === 'users_username_unique') throw conflict('USERNAME_TAKEN', "Ce nom d'utilisateur est déjà pris");
  }
  throw err;
}

export async function register(input: RegisterInput): Promise<{ user: PublicUser; token: string }> {
  const passwordHash = await hashPassword(input.password);
  // No "SELECT then INSERT": the UNIQUE constraints are the single source of
  // truth, which also works when two identical registrations arrive at once.
  const user = await insertUser({ username: input.username, email: input.email, passwordHash }).catch(
    mapUserUniqueViolation,
  );
  return { user, token: signToken({ sub: user.id, role: user.role }) };
}

export async function login(input: LoginInput): Promise<{ user: PublicUser; token: string }> {
  const row = await findUserRowByEmail(input.email);
  const valid = await bcrypt.compare(input.password, row?.password_hash ?? DUMMY_HASH);

  // Same message whether the email or the password is wrong (prevents account enumeration).
  if (!row || !valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');
  if (!row.is_active) throw new AppError(403, 'ACCOUNT_DISABLED', 'Ce compte a été désactivé');

  const user = toPublicUser(row);
  return { user, token: signToken({ sub: user.id, role: user.role }) };
}
