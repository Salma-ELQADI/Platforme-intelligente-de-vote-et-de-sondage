import jwt, { SignOptions } from 'jsonwebtoken';
import { CookieOptions } from 'express';
import { env } from '../../config/env';
import type { Role } from '../users/users.types';

export const AUTH_COOKIE = 'votelive_token';

export interface TokenPayload {
  sub: string; // user id
  role: Role;
}

/** Signs a JWT (HS256) containing only non-sensitive identifiers. */
export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

/** Returns the payload if the signature and expiry are valid, otherwise null. */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') return null;
    return { sub: decoded.sub, role: decoded.role as Role };
  } catch {
    return null;
  }
}

/** Converts "3600", "15m", "12h" or "7d" into milliseconds (same format as JWT_EXPIRES_IN). */
export function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported duration format: ${value}`);
  const unit = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2] as '' | 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unit * 1000;
}

/**
 * The token is stored in an httpOnly cookie: JavaScript running in the page
 * (including injected scripts, i.e. XSS) cannot read it.
 * SameSite=Lax blocks the cookie on cross-site POST requests (CSRF mitigation).
 */
export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: durationToMs(env.JWT_EXPIRES_IN),
  };
}
