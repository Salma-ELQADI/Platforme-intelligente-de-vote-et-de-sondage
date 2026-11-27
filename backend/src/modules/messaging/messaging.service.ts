import { pool, withTransaction, type Queryable } from '../../db/pool';
import { isOnline } from '../../socket/presence';
import { sendToUsers } from '../../socket/realtime';
import { AppError, badRequest, forbidden, notFound } from '../../utils/errors';
import { createUserRateLimiter } from '../../utils/rateLimiter';
import type { PublicUser } from '../users/users.types';
import * as repo from './messaging.repository';
import { GROUP_MAX_MEMBERS, type ListMessagesQuery } from './messaging.schemas';
import type { Conversation, MemberRole, Message } from './messaging.types';

/*
 * Authorization rules (enforced here, for REST and Socket.IO alike):
 *  - only members can see a conversation, its members or its messages; for
 *    everyone else it does not exist (404, its existence is not revealed);
 *    the platform "admin" role grants NO access to private conversations;
 *  - only members can send, and the sender is always the authenticated user;
 *  - only group ADMINs can rename a group, add or remove members, change roles;
 *  - any member can leave a group; direct conversations have fixed members.
 */

const NOT_FOUND_MESSAGE = 'Conversation introuvable';

/** 20 messages per 10 seconds and per user: generous for people, blocks floods. */
const consumeMessageBudget = createUserRateLimiter({
  limit: 20,
  windowMs: 10_000,
  message: 'Vous envoyez des messages trop rapidement, patientez quelques secondes',
});
const consumeTypingBudget = createUserRateLimiter({ limit: 40, windowMs: 10_000, message: 'Trop d’indicateurs de saisie' });

function withPresence(c: Conversation): Conversation {
  return { ...c, members: c.members.map((m) => ({ ...m, online: isOnline(m.id) })) };
}

async function requireMember(user: PublicUser, conversationId: string, db: Queryable = pool, lock = false) {
  const membership = await repo.findMembership(db, conversationId, user.id, { lock });
  if (!membership) throw notFound(NOT_FOUND_MESSAGE);
  return membership;
}

async function requireGroupAdmin(user: PublicUser, conversationId: string, db: Queryable) {
  const membership = await requireMember(user, conversationId, db);
  if (membership.type !== 'GROUP') throw badRequest('Une conversation privée ne se gère pas comme un groupe');
  if (membership.role !== 'ADMIN') throw forbidden('Seuls les administrateurs du groupe peuvent faire cela');
  return membership;
}

/** Recipients must be real, active accounts, and never the requester. */
async function resolveUsers(db: Queryable, requester: PublicUser, ids: string[]) {
  const unique = [...new Set(ids)].filter((id) => id !== requester.id);
  const active = await repo.filterActiveUserIds(db, unique);
  if (active.length !== unique.length) throw badRequest('Un ou plusieurs utilisateurs sont introuvables');
  return unique;
}

/** Pushes the new unread counters to each user (navbar badge, conversation list). */
async function pushUnread(userIds: string[], conversationId?: string) {
  if (!userIds.length) return;
  const counts = await repo.unreadCounts(userIds, conversationId);
  for (const id of userIds) {
    const c = counts.find((r) => r.user_id === id);
    sendToUsers([id], 'unread:update', {
      total: c?.total ?? 0,
      ...(conversationId && { conversationId, unreadCount: c?.in_conversation ?? 0 }),
    });
  }
}

/**
 * Tells members to re-fetch a conversation (GET /conversations/:id).
 * The payload carries only the id: each member's view (role, unread count)
 * is personal, and REST stays the single source of truth.
 */
const notifyUpdated = (userIds: string[], conversationId: string) => sendToUsers(userIds, 'conversation:updated', { conversationId });

// ---------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------

export async function listConversations(user: PublicUser, search?: string) {
  return (await repo.listConversations(user.id, search)).map(withPresence);
}

export async function getConversation(user: PublicUser, conversationId: string) {
  const conversation = await repo.findConversationForMember(user.id, conversationId);
  if (!conversation) throw notFound(NOT_FOUND_MESSAGE);
  return withPresence(conversation);
}

export async function listMessages(user: PublicUser, conversationId: string, q: ListMessagesQuery) {
  await requireMember(user, conversationId);
  return repo.listMessages(conversationId, q);
}

export async function totalUnread(user: PublicUser) {
  const [row] = await repo.unreadCounts([user.id]);
  return row?.total ?? 0;
}

// ---------------------------------------------------------------------
// Creating conversations
// ---------------------------------------------------------------------

export async function openDirect(user: PublicUser, otherId: string) {
  if (otherId === user.id) throw badRequest('Vous ne pouvez pas vous écrire à vous-même');
  const { id, created } = await withTransaction(async (tx) => {
    const [other] = await repo.filterActiveUserIds(tx, [otherId]);
    if (!other) throw notFound('Utilisateur introuvable');
    return repo.findOrCreateDirect(tx, user.id, otherId);
  });
  // The other person is told about the conversation with its first message, not before.
  return { conversation: await getConversation(user, id), created };
}

export async function createGroup(user: PublicUser, input: { name: string; memberIds: string[] }) {
  const id = await withTransaction(async (tx) => {
    const memberIds = await resolveUsers(tx, user, input.memberIds);
    if (memberIds.length === 0) throw badRequest('Ajoutez au moins un membre');
    if (memberIds.length + 1 > GROUP_MAX_MEMBERS) throw badRequest(`Un groupe compte au plus ${GROUP_MAX_MEMBERS} membres`);
    return repo.insertGroup(tx, { name: input.name, creatorId: user.id, memberIds });
  });
  notifyUpdated(await repo.listMemberIds(id), id);
  return getConversation(user, id);
}

// ---------------------------------------------------------------------
// Group management (group ADMINs only)
// ---------------------------------------------------------------------

export async function renameGroup(user: PublicUser, conversationId: string, name: string) {
  await withTransaction(async (tx) => {
    await requireGroupAdmin(user, conversationId, tx);
    await repo.renameGroup(tx, conversationId, name);
  });
  notifyUpdated(await repo.listMemberIds(conversationId), conversationId);
  return getConversation(user, conversationId);
}

export async function addMembers(user: PublicUser, conversationId: string, userIds: string[]) {
  const added = await withTransaction(async (tx) => {
    await repo.lockConversation(tx, conversationId);
    await requireGroupAdmin(user, conversationId, tx);
    const ids = await resolveUsers(tx, user, userIds);
    const { total } = await repo.countMembers(tx, conversationId);
    const inserted = await repo.insertMembers(tx, conversationId, ids);
    if (total + inserted.length > GROUP_MAX_MEMBERS) throw badRequest(`Un groupe compte au plus ${GROUP_MAX_MEMBERS} membres`);
    return inserted;
  });
  if (added.length) notifyUpdated(await repo.listMemberIds(conversationId), conversationId);
  return getConversation(user, conversationId);
}

export async function setMemberRole(user: PublicUser, conversationId: string, targetId: string, role: MemberRole) {
  await withTransaction(async (tx) => {
    await repo.lockConversation(tx, conversationId);
    await requireGroupAdmin(user, conversationId, tx);
    const target = await repo.findMembership(tx, conversationId, targetId);
    if (!target) throw notFound('Ce membre ne fait pas partie du groupe');
    if (target.role === 'ADMIN' && role === 'MEMBER' && (await repo.countMembers(tx, conversationId)).admins <= 1) {
      throw new AppError(409, 'LAST_ADMIN', 'Le groupe doit garder au moins un administrateur');
    }
    await repo.setMemberRole(tx, conversationId, targetId, role);
  });
  notifyUpdated(await repo.listMemberIds(conversationId), conversationId);
  return getConversation(user, conversationId);
}

/**
 * Removes a member (group ADMIN) or leaves the group (any member, targetId = self).
 * The removed user loses access immediately: their membership row is gone,
 * so every later read, send or real-time delivery excludes them.
 * If the last administrator leaves, the longest-standing member is promoted;
 * when the last member leaves, the group is deleted.
 */
export async function removeMember(user: PublicUser, conversationId: string, targetId: string) {
  const leaving = targetId === user.id;
  const remaining = await withTransaction(async (tx) => {
    await repo.lockConversation(tx, conversationId);
    const me = await requireMember(user, conversationId, tx);
    if (me.type !== 'GROUP') throw badRequest('On ne peut pas quitter ni modifier une conversation privée');
    if (!leaving && me.role !== 'ADMIN') throw forbidden('Seuls les administrateurs du groupe peuvent retirer un membre');
    if (!(await repo.deleteMember(tx, conversationId, targetId))) throw notFound('Ce membre ne fait pas partie du groupe');

    const { total, admins } = await repo.countMembers(tx, conversationId);
    if (total === 0) {
      await repo.deleteConversation(tx, conversationId);
      return [];
    }
    if (admins === 0) await repo.promoteOldestMember(tx, conversationId);
    return repo.listMemberIds(conversationId, tx);
  });

  sendToUsers([targetId], 'conversation:removed', { conversationId });
  notifyUpdated(remaining, conversationId);
  await pushUnread([targetId]);
  return { left: leaving };
}

// ---------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------

/**
 * Persists a message, then delivers it. The sender comes from the session,
 * never from the payload. The membership row is locked for the duration of
 * the transaction, so a concurrent removal cannot let a message slip in.
 * A retry with the same clientId returns the original message (duplicate = true)
 * and delivers nothing a second time.
 */
export async function sendMessage(user: PublicUser, conversationId: string, input: { body: string; clientId: string }) {
  const result = await withTransaction(async (tx) => {
    await requireMember(user, conversationId, tx, true);

    const existing = await repo.findMessageByClientId(tx, user.id, input.clientId);
    if (existing) {
      if (existing.conversationId !== conversationId) throw new AppError(409, 'CLIENT_ID_REUSED', 'Identifiant de message déjà utilisé');
      return { message: existing, recipients: null };
    }

    consumeMessageBudget(user.id); // retries above are free; only new messages count
    const message = await repo.insertMessage(tx, { conversationId, senderId: user.id, body: input.body, clientId: input.clientId });
    // null = the same retry raced us and won: return its message.
    if (!message) return { message: (await repo.findMessageByClientId(tx, user.id, input.clientId))!, recipients: null };
    await repo.touchAfterMessage(tx, message);
    return { message, recipients: await repo.listMemberIds(conversationId, tx) };
  });

  const { message, recipients } = result;
  if (!recipients) return { message, duplicate: true };

  // After COMMIT: every member's sockets (all tabs of the sender included).
  sendToUsers(recipients, 'message:new', { message });
  sendToUsers(recipients, 'typing', { conversationId, user: { id: user.id, username: user.username }, isTyping: false });
  await pushUnread(
    recipients.filter((id) => id !== user.id),
    conversationId,
  );
  return { message: message as Message, duplicate: false };
}

/**
 * Announces a freshly published group poll in the group's chat, as a POLL
 * message from its author. Called after the publication has committed; the
 * UNIQUE (poll_id) constraint guarantees a single announcement per poll.
 */
export async function postPollMessage(author: PublicUser, groupId: string, pollId: string, question: string) {
  const result = await withTransaction(async (tx) => {
    const message = await repo.insertMessage(tx, { conversationId: groupId, senderId: author.id, body: question, clientId: pollId, pollId });
    if (!message) return null;
    await repo.touchAfterMessage(tx, message);
    return { message, recipients: await repo.listMemberIds(groupId, tx) };
  });
  if (!result) return;
  sendToUsers(result.recipients, 'message:new', { message: result.message });
  await pushUnread(
    result.recipients.filter((id) => id !== author.id),
    groupId,
  );
}

/** Moves the reader's position forward and broadcasts the read receipt to the members. */
export async function markRead(user: PublicUser, conversationId: string, seq?: number) {
  await requireMember(user, conversationId);
  const lastReadSeq = await repo.markRead(pool, conversationId, user.id, seq);
  if (lastReadSeq === null) throw notFound(NOT_FOUND_MESSAGE);
  sendToUsers(await repo.listMemberIds(conversationId), 'conversation:read', { conversationId, userId: user.id, lastReadSeq });
  await pushUnread([user.id], conversationId);
  return { lastReadSeq };
}

/** Typing indicator: relayed to the other members only, never stored. */
export async function relayTyping(user: PublicUser, conversationId: string, isTyping: boolean) {
  consumeTypingBudget(user.id);
  await requireMember(user, conversationId);
  const others = (await repo.listMemberIds(conversationId)).filter((id) => id !== user.id);
  sendToUsers(others, 'typing', { conversationId, user: { id: user.id, username: user.username }, isTyping });
}
