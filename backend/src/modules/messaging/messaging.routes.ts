import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { uuidParam, validate } from '../../middleware/validate';
import {
  addMembersSchema,
  createDirectSchema,
  createGroupSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  markReadSchema,
  memberParams,
  sendMessageSchema,
  updateGroupSchema,
  updateMemberSchema,
  type ListMessagesQuery,
} from './messaging.schemas';
import { listGroupPolls } from '../polls/polls.service';
import * as service from './messaging.service';

/**
 * REST is the source of truth for conversations and history. Socket.IO
 * only pushes what changed (see src/socket/messaging.ts). Every route runs
 * the membership checks of messaging.service.
 */
export const conversationsRouter = Router();
conversationsRouter.use(authenticate);

// GET /api/conversations?search=
conversationsRouter.get('/', validate({ query: listConversationsQuerySchema }), async (req, res) => {
  const { search } = req.query as { search?: string };
  const conversations = await service.listConversations(req.user!, search || undefined);
  res.json({ success: true, data: { conversations } });
});

// GET /api/conversations/unread-count
conversationsRouter.get('/unread-count', async (req, res) => {
  res.json({ success: true, data: { total: await service.totalUnread(req.user!) } });
});

// POST /api/conversations/direct { userId } → existing or new private conversation
conversationsRouter.post('/direct', validate({ body: createDirectSchema }), async (req, res) => {
  const { conversation, created } = await service.openDirect(req.user!, req.body.userId);
  res.status(created ? 201 : 200).json({ success: true, data: { conversation } });
});

// POST /api/conversations/groups { name, memberIds }
conversationsRouter.post('/groups', validate({ body: createGroupSchema }), async (req, res) => {
  const conversation = await service.createGroup(req.user!, req.body);
  res.status(201).json({ success: true, data: { conversation } });
});

// GET /api/conversations/:id
conversationsRouter.get('/:id', validate({ params: uuidParam() }), async (req, res) => {
  const conversation = await service.getConversation(req.user!, req.params.id as string);
  res.json({ success: true, data: { conversation } });
});

// PATCH /api/conversations/:id { name }  (group admins)
conversationsRouter.patch('/:id', validate({ params: uuidParam(), body: updateGroupSchema }), async (req, res) => {
  const conversation = await service.renameGroup(req.user!, req.params.id as string, req.body.name);
  res.json({ success: true, data: { conversation } });
});

// POST /api/conversations/:id/members { userIds }  (group admins)
conversationsRouter.post('/:id/members', validate({ params: uuidParam(), body: addMembersSchema }), async (req, res) => {
  const conversation = await service.addMembers(req.user!, req.params.id as string, req.body.userIds);
  res.json({ success: true, data: { conversation } });
});

// PATCH /api/conversations/:id/members/:userId { role }  (group admins)
conversationsRouter.patch('/:id/members/:userId', validate({ params: memberParams, body: updateMemberSchema }), async (req, res) => {
  const conversation = await service.setMemberRole(req.user!, req.params.id as string, req.params.userId as string, req.body.role);
  res.json({ success: true, data: { conversation } });
});

// DELETE /api/conversations/:id/members/:userId  (group admins, or yourself to leave)
conversationsRouter.delete('/:id/members/:userId', validate({ params: memberParams }), async (req, res) => {
  const data = await service.removeMember(req.user!, req.params.id as string, req.params.userId as string);
  res.json({ success: true, data });
});

// GET /api/conversations/:id/messages?before=<seq>|after=<seq>&limit=30
conversationsRouter.get('/:id/messages', validate({ params: uuidParam(), query: listMessagesQuerySchema }), async (req, res) => {
  const data = await service.listMessages(req.user!, req.params.id as string, req.query as unknown as ListMessagesQuery);
  res.json({ success: true, data });
});

// POST /api/conversations/:id/messages { body, clientId }
conversationsRouter.post('/:id/messages', validate({ params: uuidParam(), body: sendMessageSchema }), async (req, res) => {
  const { message, duplicate } = await service.sendMessage(req.user!, req.params.id as string, req.body);
  res.status(duplicate ? 200 : 201).json({ success: true, data: { message } });
});

// GET /api/conversations/:id/polls  (group polls, members only)
conversationsRouter.get('/:id/polls', validate({ params: uuidParam() }), async (req, res) => {
  const polls = await listGroupPolls(req.user!, req.params.id as string);
  res.json({ success: true, data: { polls } });
});

// POST /api/conversations/:id/read { seq? }
conversationsRouter.post('/:id/read', validate({ params: uuidParam(), body: markReadSchema }), async (req, res) => {
  const data = await service.markRead(req.user!, req.params.id as string, req.body.seq);
  res.json({ success: true, data });
});
