import bcrypt from 'bcryptjs';
import { AppError, badRequest, notFound } from '../../utils/errors';
import { hashPassword, mapUserUniqueViolation } from '../auth/auth.service';
import { findUserRowById, updateUser } from './users.repository';
import type { PublicUser, Role } from './users.types';

export async function updateProfile(
  userId: string,
  input: { username?: string; email?: string; newPassword?: string; currentPassword?: string },
): Promise<PublicUser> {
  const row = await findUserRowById(userId);
  if (!row) throw notFound('Utilisateur introuvable');

  // Sensitive changes require re-authentication with the current password.
  if (input.newPassword || input.email) {
    const ok = await bcrypt.compare(input.currentPassword ?? '', row.password_hash);
    if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Mot de passe actuel incorrect');
  }

  const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : undefined;
  const user = await updateUser(userId, { username: input.username, email: input.email, passwordHash }).catch(
    mapUserUniqueViolation,
  );
  return user!;
}

export async function adminUpdateUser(
  actor: PublicUser,
  targetId: string,
  input: { role?: Role; isActive?: boolean },
): Promise<PublicUser> {
  if (actor.id === targetId) {
    // Prevents an admin from locking themselves out by mistake.
    throw badRequest('Vous ne pouvez pas modifier votre propre rôle ou statut');
  }
  const user = await updateUser(targetId, input);
  if (!user) throw notFound('Utilisateur introuvable');
  return user;
}
