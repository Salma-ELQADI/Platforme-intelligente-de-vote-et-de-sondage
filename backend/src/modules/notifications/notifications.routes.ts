import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { uuidParam, validate } from '../../middleware/validate';
import { notFound } from '../../utils/errors';
import * as repo from './notifications.repository';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

const listQuery = z.object({
  unreadOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// GET /api/notifications
notificationsRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const { unreadOnly, limit } = req.query as unknown as z.infer<typeof listQuery>;
  const data = await repo.listNotifications(req.user!.id, { unreadOnly, limit });
  res.json({ success: true, data });
});

// PATCH /api/notifications/read-all
notificationsRouter.patch('/read-all', async (req, res) => {
  const updated = await repo.markAllAsRead(req.user!.id);
  res.json({ success: true, data: { updated } });
});

// PATCH /api/notifications/:id/read
notificationsRouter.patch('/:id/read', validate({ params: uuidParam() }), async (req, res) => {
  const notification = await repo.markAsRead(req.user!.id, req.params.id as string);
  if (!notification) throw notFound('Notification introuvable');
  res.json({ success: true, data: { notification } });
});
