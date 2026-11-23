import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { loginSchema, registerSchema } from './auth.schemas';
import * as authService from './auth.service';
import { AUTH_COOKIE, authCookieOptions } from './auth.tokens';

export const authRouter = Router();

// POST /api/auth/register
authRouter.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
  const { user, token } = await authService.register(req.body);
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
  res.status(201).json({ success: true, data: { user, token } });
});

// POST /api/auth/login
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { user, token } = await authService.login(req.body);
  res.cookie(AUTH_COOKIE, token, authCookieOptions());
  res.json({ success: true, data: { user, token } });
});

// POST /api/auth/logout
authRouter.post('/logout', (_req, res) => {
  const { maxAge: _maxAge, ...opts } = authCookieOptions();
  res.clearCookie(AUTH_COOKIE, opts);
  res.json({ success: true, data: { message: 'Déconnexion réussie' } });
});

// GET /api/auth/me
authRouter.get('/me', authenticate, (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});
