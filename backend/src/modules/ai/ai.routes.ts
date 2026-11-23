import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { generatePollSchema } from './ai.schemas';
import { generatePoll } from './ai.service';

export const aiRouter = Router();

// POST /api/ai/generate
aiRouter.post('/generate', authenticate, aiLimiter, validate({ body: generatePollSchema }), async (req, res) => {
  const poll = await generatePoll(req.body);
  res.json({ success: true, data: { poll } });
});
