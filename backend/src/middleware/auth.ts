import { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../utils/errors';
import { AUTH_COOKIE, verifyToken } from '../modules/auth/auth.tokens';
import { findUserById } from '../modules/users/users.repository';
import type { Role } from '../modules/users/users.types';

/** Reads the JWT from the httpOnly cookie, or from "Authorization: Bearer ..." (API clients, tests). */
export function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/**
 * AUTHENTICATION: "who are you?"
 * Verifies the token signature and expiry, then reloads the user from the
 * database so that a deleted, deactivated or demoted account is rejected
 * immediately even if its token has not expired yet.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) throw unauthorized();

  const payload = verifyToken(token);
  if (!payload) throw unauthorized('Session invalide ou expirée');

  const user = await findUserById(payload.sub);
  if (!user || !user.isActive) throw unauthorized('Session invalide ou expirée');

  req.user = user;
  next();
}

/**
 * AUTHORIZATION: "are you allowed to do this?"
 * Must be placed after `authenticate`.
 */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
