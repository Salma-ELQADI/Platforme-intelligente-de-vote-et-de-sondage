import { pool, query, Queryable } from '../../db/pool';
import type { Conversation, ConversationRow, MemberRole, Message, MessageRow } from './messaging.types';

export function toMessage(r: MessageRow | NonNullable<ConversationRow['last_message']>): Message {
  return {
    id: r.id,
    kind: r.kind,
    poll: r.poll ? { ...r.poll, endTime: new Date(r.poll.endTime).toISOString() } : null,
    seq: Number(r.seq),
    conversationId: r.conversation_id,
    sender: r.sender_id ? { id: r.sender_id, username: r.sender_username ?? '' } : null,
    body: r.body,
    clientId: r.client_id,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** Presence is not stored in the database: the service fills `online` afterwards. */
function toConversation(r: ConversationRow): Conversation {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    createdBy: r.created_by,
    myRole: r.my_role,
    myLastReadSeq: Number(r.my_last_read_seq),
    members: r.members.map((m) => ({ ...m, lastReadSeq: Number(m.lastReadSeq), joinedAt: new Date(m.joinedAt).toISOString(), online: false })),
    lastMessage: r.last_message ? toMessage(r.last_message) : null,
    unreadCount: r.unread_count,
    lastMessageAt: r.last_message_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** JSON snapshot of the poll announced by a POLL message (alias "msg"). */
const MESSAGE_POLL_JSON = `
  (SELECT json_build_object('id', pp.id, 'question', pp.question, 'status', pp.status, 'endTime', pp.end_time,
                            'optionCount', (SELECT COUNT(*) FROM poll_options po WHERE po.poll_id = pp.id))
     FROM polls pp WHERE pp.id = msg.poll_id)`;

/**
 * Conversations of user $1, each with its members, last message and the
 * user's unread count, in one round trip. Starting from the viewer's own
 * membership row ("me") is what guarantees that nobody can list a
 * conversation they do not belong to.
 */
const CONVERSATION_SELECT = `
  SELECT c.*,
         me.role          AS my_role,
         me.last_read_seq AS my_last_read_seq,
         (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'role', m.role,
                                            'lastReadSeq', m.last_read_seq, 'joinedAt', m.joined_at)
                          ORDER BY m.joined_at, u.username)
            FROM conversation_members m JOIN users u ON u.id = m.user_id
           WHERE m.conversation_id = c.id) AS members,
         (SELECT row_to_json(lm) FROM (
            SELECT msg.id, msg.seq, msg.conversation_id, msg.sender_id, su.username AS sender_username,
                   msg.body, msg.client_id, msg.created_at, msg.kind, ${MESSAGE_POLL_JSON} AS poll
              FROM messages msg LEFT JOIN users su ON su.id = msg.sender_id
             WHERE msg.conversation_id = c.id
             ORDER BY msg.seq DESC LIMIT 1) lm) AS last_message,
         (SELECT COUNT(*) FROM messages x
           WHERE x.conversation_id = c.id AND x.seq > me.last_read_seq
             AND x.sender_id IS DISTINCT FROM $1)::int AS unread_count
    FROM conversation_members me
    JOIN conversations c ON c.id = me.conversation_id
   WHERE me.user_id = $1`;

/**
 * Lists the viewer's conversations, most recent activity first. A direct
 * conversation opened but never written to only appears for the person
 * who opened it, so nobody sees empty threads they did not start.
 */
export async function listConversations(userId: string, search?: string, db: Queryable = pool): Promise<Conversation[]> {
  const params: unknown[] = [userId];
  let filter = '';
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    filter = `AND (c.name ILIKE $2 OR EXISTS (
                SELECT 1 FROM conversation_members m2 JOIN users u2 ON u2.id = m2.user_id
                 WHERE m2.conversation_id = c.id AND m2.user_id <> $1 AND u2.username ILIKE $2))`;
  }
  const { rows } = await db.query<ConversationRow>(
    `${CONVERSATION_SELECT}
       AND (c.type = 'GROUP' OR c.last_message_at IS NOT NULL OR c.created_by = $1)
       ${filter}
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
     LIMIT 200`,
    params,
  );
  return rows.map(toConversation);
}

/** One conversation, or null when it does not exist OR the user is not a member. */
export async function findConversationForMember(userId: string, conversationId: string, db: Queryable = pool) {
  const { rows } = await db.query<ConversationRow>(`${CONVERSATION_SELECT} AND c.id = $2`, [userId, conversationId]);
  return rows[0] ? toConversation(rows[0]) : null;
}

/**
 * Membership check used before every read or write. Inactive accounts are
 * treated as non-members. With `lock`, the membership row is locked until the
 * end of the transaction: a concurrent removal (DELETE) waits, so a message can
 * never be written by someone who has just been removed. NO KEY UPDATE rather
 * than SHARE because the sender's own row is updated later in the same
 * transaction (read position): two concurrent sends by the same user (two tabs)
 * then queue up instead of deadlocking.
 */
export async function findMembership(db: Queryable, conversationId: string, userId: string, { lock = false } = {}) {
  const { rows } = await db.query<{ role: MemberRole; type: 'DIRECT' | 'GROUP'; last_read_seq: string }>(
    `SELECT m.role, c.type, m.last_read_seq
       FROM conversation_members m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = m.user_id AND u.is_active
      WHERE m.conversation_id = $1 AND m.user_id = $2
      ${lock ? 'FOR NO KEY UPDATE OF m' : ''}`,
    [conversationId, userId],
  );
  return rows[0] ?? null;
}

export async function listMemberIds(conversationId: string, db: Queryable = pool): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>('SELECT user_id FROM conversation_members WHERE conversation_id = $1', [
    conversationId,
  ]);
  return rows.map((r) => r.user_id);
}

/** Every user sharing at least one conversation with `userId` (presence recipients). */
export async function listContactIds(userId: string): Promise<string[]> {
  const { rows } = await query<{ user_id: string }>(
    `SELECT DISTINCT m2.user_id
       FROM conversation_members m1
       JOIN conversation_members m2 ON m2.conversation_id = m1.conversation_id
      WHERE m1.user_id = $1 AND m2.user_id <> $1`,
    [userId],
  );
  return rows.map((r) => r.user_id);
}

/** Keeps only the ids of existing, active accounts. */
export async function filterActiveUserIds(db: Queryable, ids: string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_active', [ids]);
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------
// Conversations and members
// ---------------------------------------------------------------------

/** Canonical key of the pair: the same whatever the order of the two ids. */
export const directKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Returns the direct conversation between two users, creating it if needed.
 * ON CONFLICT on the UNIQUE direct_key makes concurrent calls converge on a
 * single row instead of failing or creating duplicates.
 */
export async function findOrCreateDirect(db: Queryable, creatorId: string, otherId: string) {
  const key = directKey(creatorId, otherId);
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO conversations (type, created_by, direct_key) VALUES ('DIRECT', $1, $2)
     ON CONFLICT (direct_key) DO NOTHING RETURNING id`,
    [creatorId, key],
  );
  if (inserted.rows[0]) {
    await db.query(
      `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1, $2, 'MEMBER'), ($1, $3, 'MEMBER')`,
      [inserted.rows[0].id, creatorId, otherId],
    );
    return { id: inserted.rows[0].id, created: true };
  }
  const { rows } = await db.query<{ id: string }>('SELECT id FROM conversations WHERE direct_key = $1', [key]);
  return { id: rows[0].id, created: false };
}

export async function insertGroup(db: Queryable, data: { name: string; creatorId: string; memberIds: string[] }) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO conversations (type, name, created_by) VALUES ('GROUP', $1, $2) RETURNING id`,
    [data.name, data.creatorId],
  );
  const id = rows[0].id;
  await db.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role)
     SELECT $1, u, CASE WHEN u = $2 THEN 'ADMIN' ELSE 'MEMBER' END
       FROM unnest($3::uuid[]) AS u`,
    [id, data.creatorId, [data.creatorId, ...data.memberIds]],
  );
  return id;
}

export async function renameGroup(db: Queryable, conversationId: string, name: string) {
  await db.query('UPDATE conversations SET name = $2 WHERE id = $1', [conversationId, name]);
}

/** Adds members, ignoring those already present. Returns the ids actually added. */
export async function insertMembers(db: Queryable, conversationId: string, userIds: string[]) {
  // New members start "caught up": earlier history is visible but not counted as unread.
  const { rows } = await db.query<{ user_id: string }>(
    `INSERT INTO conversation_members (conversation_id, user_id, role, last_read_seq)
     SELECT $1, u, 'MEMBER', COALESCE((SELECT MAX(seq) FROM messages WHERE conversation_id = $1), 0)
       FROM unnest($2::uuid[]) AS u
     ON CONFLICT (conversation_id, user_id) DO NOTHING
     RETURNING user_id`,
    [conversationId, userIds],
  );
  return rows.map((r) => r.user_id);
}

export async function countMembers(db: Queryable, conversationId: string) {
  const { rows } = await db.query<{ total: number; admins: number }>(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE role = 'ADMIN')::int AS admins
       FROM conversation_members WHERE conversation_id = $1`,
    [conversationId],
  );
  return rows[0];
}

export async function deleteMember(db: Queryable, conversationId: string, userId: string) {
  const { rowCount } = await db.query('DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [
    conversationId,
    userId,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function setMemberRole(db: Queryable, conversationId: string, userId: string, role: MemberRole) {
  const { rowCount } = await db.query('UPDATE conversation_members SET role = $3 WHERE conversation_id = $1 AND user_id = $2', [
    conversationId,
    userId,
    role,
  ]);
  return (rowCount ?? 0) > 0;
}

/** A group must keep an administrator: the longest-standing member is promoted. */
export async function promoteOldestMember(db: Queryable, conversationId: string) {
  const { rows } = await db.query<{ user_id: string }>(
    `UPDATE conversation_members SET role = 'ADMIN'
      WHERE (conversation_id, user_id) = (
        SELECT conversation_id, user_id FROM conversation_members
         WHERE conversation_id = $1 ORDER BY joined_at, user_id LIMIT 1)
     RETURNING user_id`,
    [conversationId],
  );
  return rows[0]?.user_id ?? null;
}

export async function deleteConversation(db: Queryable, conversationId: string) {
  await db.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
}

/** Locks the conversation row: serialises concurrent membership changes of one group. */
export async function lockConversation(db: Queryable, conversationId: string) {
  await db.query('SELECT 1 FROM conversations WHERE id = $1 FOR UPDATE', [conversationId]);
}

// ---------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------

const MESSAGE_SELECT = `
  SELECT msg.*, u.username AS sender_username, ${MESSAGE_POLL_JSON} AS poll
    FROM messages msg LEFT JOIN users u ON u.id = msg.sender_id`;

/**
 * Inserts a message. If this sender already sent a message with the same
 * client id (a retry), nothing is inserted and `null` is returned.
 */
export async function insertMessage(
  db: Queryable,
  data: { conversationId: string; senderId: string; body: string; clientId: string; pollId?: string },
) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO messages (conversation_id, sender_id, body, client_id, kind, poll_id) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING RETURNING id`,
    [data.conversationId, data.senderId, data.body, data.clientId, data.pollId ? 'POLL' : 'TEXT', data.pollId ?? null],
  );
  if (!rows[0]) return null;
  const { rows: full } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE msg.id = $1`, [rows[0].id]);
  return toMessage(full[0]);
}

export async function findMessageByClientId(db: Queryable, senderId: string, clientId: string) {
  const { rows } = await db.query<MessageRow>(`${MESSAGE_SELECT} WHERE msg.sender_id = $1 AND msg.client_id = $2`, [senderId, clientId]);
  return rows[0] ? toMessage(rows[0]) : null;
}

/** After a new message: bumps the list ordering and marks it read for its own author. */
export async function touchAfterMessage(db: Queryable, message: Message) {
  await db.query('UPDATE conversations SET last_message_at = $2 WHERE id = $1', [message.conversationId, message.createdAt]);
  await db.query(
    'UPDATE conversation_members SET last_read_seq = GREATEST(last_read_seq, $3) WHERE conversation_id = $1 AND user_id = $2',
    [message.conversationId, message.sender!.id, message.seq],
  );
}

/**
 * Keyset pagination on seq (no OFFSET, stable while new messages arrive):
 *  - before: the page of older messages just above a cursor (infinite scroll upwards);
 *  - after:  every message newer than a cursor (catch-up after a reconnection).
 * Messages are always returned oldest first.
 */
export async function listMessages(conversationId: string, opts: { before?: number; after?: number; limit: number }) {
  if (opts.after !== undefined) {
    const { rows } = await query<MessageRow>(
      `${MESSAGE_SELECT} WHERE msg.conversation_id = $1 AND msg.seq > $2 ORDER BY msg.seq ASC LIMIT $3`,
      [conversationId, opts.after, opts.limit + 1],
    );
    return { messages: rows.slice(0, opts.limit).map(toMessage), hasMore: rows.length > opts.limit };
  }
  const { rows } = await query<MessageRow>(
    `${MESSAGE_SELECT} WHERE msg.conversation_id = $1 AND ($2::bigint IS NULL OR msg.seq < $2)
      ORDER BY msg.seq DESC LIMIT $3`,
    [conversationId, opts.before ?? null, opts.limit + 1],
  );
  return { messages: rows.slice(0, opts.limit).reverse().map(toMessage), hasMore: rows.length > opts.limit };
}

/**
 * Moves the read position forward (never backwards: a late or duplicated
 * read event cannot "unread" messages), capped at the newest existing message.
 */
export async function markRead(db: Queryable, conversationId: string, userId: string, seq?: number) {
  const { rows } = await db.query<{ last_read_seq: string }>(
    `UPDATE conversation_members m
        SET last_read_seq = GREATEST(m.last_read_seq,
              LEAST(COALESCE($3::bigint, 9223372036854775807),
                    (SELECT COALESCE(MAX(seq), 0) FROM messages WHERE conversation_id = $1)))
      WHERE m.conversation_id = $1 AND m.user_id = $2
      RETURNING m.last_read_seq`,
    [conversationId, userId, seq ?? null],
  );
  return rows[0] ? Number(rows[0].last_read_seq) : null;
}

/** For each user: total unread messages, and unread messages in one conversation. */
export async function unreadCounts(userIds: string[], conversationId?: string) {
  const { rows } = await query<{ user_id: string; total: number; in_conversation: number }>(
    `SELECT m.user_id,
            COUNT(x.id)::int AS total,
            COUNT(x.id) FILTER (WHERE m.conversation_id = $2)::int AS in_conversation
       FROM conversation_members m
       LEFT JOIN messages x ON x.conversation_id = m.conversation_id
                           AND x.seq > m.last_read_seq
                           AND x.sender_id IS DISTINCT FROM m.user_id
      WHERE m.user_id = ANY($1::uuid[])
      GROUP BY m.user_id`,
    [userIds, conversationId ?? null],
  );
  return rows;
}
