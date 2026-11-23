import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { uuidParam, validate } from '../../middleware/validate';
import { findUserById, listUsers } from './users.repository';
import { adminUpdateUserSchema, listUsersQuerySchema, updateProfileSchema } from './users.schemas';
import * as usersService from './users.service';
import { notFound } from '../../utils/errors';

export const usersRouter = Router();
usersRouter.use(authenticate);

// GET /api/users/me
usersRouter.get('/me', (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

// PATCH /api/users/me
usersRouter.patch('/me', validate({ body: updateProfileSchema }), async (req, res) => {
  const user = await usersService.updateProfile(req.user!.id, req.body);
  res.json({ success: true, data: { user } });
});

// ---------- Administration (admin role only) ----------

// GET /api/users
usersRouter.get('/', requireRole('admin'), validate({ query: listUsersQuerySchema }), async (req, res) => {
  const { page, limit, search } = req.query as unknown as { page: number; limit: number; search?: string };
  const { users, total } = await listUsers({ limit, offset: (page - 1) * limit, search });
  res.json({ success: true, data: { users, pagination: { page, limit, total } } });
});

// GET /api/users/:id
usersRouter.get('/:id', requireRole('admin'), validate({ params: uuidParam() }), async (req, res) => {
  const user = await findUserById(req.params.id as string);
  if (!user) throw notFound('Utilisateur introuvable');
  res.json({ success: true, data: { user } });
});

// PATCH /api/users/:id
usersRouter.patch(
  '/:id',
  requireRole('admin'),
  validate({ params: uuidParam(), body: adminUpdateUserSchema }),
  async (req, res) => {
    const user = await usersService.adminUpdateUser(req.user!, req.params.id as string, req.body);
    res.json({ success: true, data: { user } });
  },
);
