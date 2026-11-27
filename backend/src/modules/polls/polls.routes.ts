import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { uuidParam, validate } from '../../middleware/validate';
import { getPollSummary } from '../ai/ai.summary';
import { castVote } from '../votes/votes.service';
import { listPollsByCreator } from './polls.repository';
import { createPollSchema, listPollsQuerySchema, myPollsQuerySchema, updatePollSchema, type ListPollsQuery } from './polls.schemas';
import * as pollsService from './polls.service';
import type { PollStatus } from './polls.types';

export const pollsRouter = Router();
pollsRouter.use(authenticate);

const idParam = { params: uuidParam() };
/**
 * { optionId } for a single-choice ballot (kept for compatibility), or
 * { optionIds } for any method: the selected answers, in order of preference
 * for ranked polls.
 */
const voteSchema = z
  .object({
    optionId: z.uuid({ error: 'Proposition invalide' }).optional(),
    optionIds: z.array(z.uuid({ error: 'Proposition invalide' })).min(1, 'Choisissez au moins une proposition').max(10).optional(),
  })
  .refine((b) => (b.optionId === undefined) !== (b.optionIds === undefined), { message: 'Envoyez optionId ou optionIds' });
const summaryQuery = z.object({ locale: z.enum(['fr', 'en', 'ar']).default('fr') });

// GET /api/polls?status=ACTIVE|CLOSED&search=&page=&limit=
pollsRouter.get('/', validate({ query: listPollsQuerySchema }), async (req, res) => {
  const data = await pollsService.listPolls(req.user!, req.query as unknown as ListPollsQuery);
  res.json({ success: true, data });
});

// GET /api/polls/mine?status=
pollsRouter.get('/mine', validate({ query: myPollsQuerySchema }), async (req, res) => {
  const { status } = req.query as { status?: PollStatus };
  const polls = await listPollsByCreator(req.user!.id, status);
  res.json({ success: true, data: { polls } });
});

// POST /api/polls
pollsRouter.post('/', validate({ body: createPollSchema }), async (req, res) => {
  const poll = await pollsService.createPoll(req.user!, req.body);
  res.status(201).json({ success: true, data: { poll } });
});

// GET /api/polls/:id
pollsRouter.get('/:id', validate(idParam), async (req, res) => {
  const poll = await pollsService.getPollForViewer(req.user!, req.params.id as string);
  res.json({ success: true, data: { poll } });
});

// PATCH /api/polls/:id
pollsRouter.patch('/:id', validate({ ...idParam, body: updatePollSchema }), async (req, res) => {
  const poll = await pollsService.updatePoll(req.user!, req.params.id as string, req.body);
  res.json({ success: true, data: { poll } });
});

// DELETE /api/polls/:id
pollsRouter.delete('/:id', validate(idParam), async (req, res) => {
  await pollsService.deletePoll(req.user!, req.params.id as string);
  res.status(204).end();
});

// POST /api/polls/:id/publish
pollsRouter.post('/:id/publish', validate(idParam), async (req, res) => {
  const poll = await pollsService.publishPoll(req.user!, req.params.id as string);
  res.json({ success: true, data: { poll } });
});

// POST /api/polls/:id/unschedule  (SCHEDULED → DRAFT)
pollsRouter.post('/:id/unschedule', validate(idParam), async (req, res) => {
  const poll = await pollsService.unschedulePoll(req.user!, req.params.id as string);
  res.json({ success: true, data: { poll } });
});

// GET /api/polls/:id/summary?locale=fr  (AI summary of a closed poll)
pollsRouter.get('/:id/summary', validate({ ...idParam, query: summaryQuery }), async (req, res) => {
  const { locale } = req.query as unknown as z.infer<typeof summaryQuery>;
  const summary = await getPollSummary(req.user!, req.params.id as string, locale);
  res.json({ success: true, data: { summary } });
});

// POST /api/polls/:id/close
pollsRouter.post('/:id/close', validate(idParam), async (req, res) => {
  const poll = await pollsService.closePollManually(req.user!, req.params.id as string);
  res.json({ success: true, data: { poll } });
});

// GET /api/polls/:id/results
pollsRouter.get('/:id/results', validate(idParam), async (req, res) => {
  const results = await pollsService.getResults(req.user!, req.params.id as string);
  res.json({ success: true, data: { results } });
});

// POST /api/polls/:id/votes
pollsRouter.post('/:id/votes', validate({ ...idParam, body: voteSchema }), async (req, res) => {
  const data = await castVote(req.user!, req.params.id as string, req.body.optionIds ?? [req.body.optionId]);
  res.status(201).json({ success: true, data });
});
