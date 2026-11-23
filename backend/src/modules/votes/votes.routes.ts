import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as votesService from './votes.service';

export const votesRouter = Router();
votesRouter.use(authenticate);

// GET /api/votes/me
votesRouter.get('/me', async (req, res) => {
  const votes = await votesService.listMyVotes(req.user!);
  res.json({ success: true, data: { votes } });
});
