import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { uuidParam, validate } from '../../middleware/validate';
import { findActiveUsersByIdentifiers, findUserById, listUsers, searchDirectory, updatePreferences } from './users.repository';
import {
  adminUpdateUserSchema,
  directoryQuerySchema,
  listUsersQuerySchema,
  lookupUserQuerySchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from './users.schemas';
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

// PATCH /api/users/me/preferences  { locale?, theme?, messageNotifications? }
usersRouter.patch('/me/preferences', validate({ body: updatePreferencesSchema }), async (req, res) => {
  const user = await updatePreferences(req.user!.id, req.body);
  if (!user) throw notFound('Utilisateur introuvable');
  res.json({ success: true, data: { user } });
});

// GET /api/users/directory?search=al
// People picker for new conversations: active users only, id + username, never the email.
usersRouter.get('/directory', validate({ query: directoryQuerySchema }), async (req, res) => {
  const { search, limit } = req.query as unknown as { search: string; limit: number };
  const users = await searchDirectory(req.user!.id, search, limit);
  res.json({ success: true, data: { users } });
});

// GET /api/users/lookup?identifier=<username or email>
// Used to invite voters to a private poll. Exact match only, and the email is
// never returned: it only confirms that an account exists.
usersRouter.get('/lookup', validate({ query: lookupUserQuerySchema }), async (req, res) => {
  const [match] = await findActiveUsersByIdentifiers([(req.query as { identifier: string }).identifier]);
  if (!match?.id) throw notFound('Aucun utilisateur ne correspond à ce nom ou à cet email');
  res.json({ success: true, data: { user: { id: match.id, username: match.username } } });
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
