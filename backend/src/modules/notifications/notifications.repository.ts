import { query, Queryable } from '../../db/pool';
import type { Notification, NotificationRow } from './notifications.types';

export const toNotification = (r: NotificationRow): Notification => ({
  id: r.id,
  type: r.type,
  message: r.message,
  pollId: r.poll_id,
  pollQuestion: r.poll_question,
  invitation: r.invitation ?? null,
  isRead: r.is_read,
  createdAt: r.created_at.toISOString(),
});

/**
 * Creates one POLL_CLOSED notification for the creator and for every voter
 * of each given poll. ON CONFLICT DO NOTHING + the UNIQUE constraint make the
 * operation idempotent: running it twice never duplicates notifications.
 */
export async function insertClosureNotifications(db: Queryable, pollIds: string[]) {
  const { rows } = await db.query<NotificationRow>(
    `INSERT INTO notifications (user_id, poll_id, type, message)
     SELECT recipients.user_id, p.id, 'POLL_CLOSED',
            'Le sondage « ' || left(p.question, 200) || ' » est clôturé. Les résultats définitifs sont disponibles.'
       FROM polls p
       JOIN LATERAL (
              SELECT p.created_by AS user_id
              UNION
              SELECT v.user_id FROM votes v WHERE v.poll_id = p.id
            ) recipients ON TRUE
      WHERE p.id = ANY($1::uuid[])
     ON CONFLICT (user_id, poll_id, type) DO NOTHING
     RETURNING *, (SELECT question FROM polls WHERE polls.id = notifications.poll_id) AS poll_question`,
    [pollIds],
  );
  return rows;
}

/**
 * A PRIVATE poll has just opened: its invited voters are told they can vote.
 * (Group polls are announced in the group chat instead.) Idempotent, like closures.
 */
export async function insertOpenedNotifications(db: Queryable, pollIds: string[]) {
  const { rows } = await db.query<NotificationRow>(
    `INSERT INTO notifications (user_id, poll_id, type, message)
     SELECT pv.user_id, p.id, 'POLL_OPENED',
            'Vous êtes invité à voter au sondage « ' || left(p.question, 200) || ' ».'
       FROM polls p JOIN poll_voters pv ON pv.poll_id = p.id
      WHERE p.id = ANY($1::uuid[]) AND p.access = 'PRIVATE'
     ON CONFLICT (user_id, poll_id, type) DO NOTHING
     RETURNING *, (SELECT question FROM polls WHERE polls.id = notifications.poll_id) AS poll_question`,
    [pollIds],
  );
  return rows;
}

/**
 * Reminder before closing, for the eligible voters who have NOT voted:
 * invited voters of a PRIVATE poll, current members of a GROUP poll's group
 * (the author included: group polls are a shared decision).
 */
export async function insertReminderNotifications(db: Queryable, pollIds: string[]) {
  const { rows } = await db.query<NotificationRow>(
    `INSERT INTO notifications (user_id, poll_id, type, message)
     SELECT e.user_id, p.id, 'POLL_REMINDER',
            'Le sondage « ' || left(p.question, 200) || ' » se termine bientôt : vous n''avez pas encore voté.'
       FROM polls p
       JOIN LATERAL (
              SELECT pv.user_id FROM poll_voters pv WHERE pv.poll_id = p.id AND p.access = 'PRIVATE'
              UNION
              SELECT cm.user_id FROM conversation_members cm WHERE cm.conversation_id = p.group_id AND p.access = 'GROUP'
            ) e ON TRUE
      WHERE p.id = ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.user_id = e.user_id)
     ON CONFLICT (user_id, poll_id, type) DO NOTHING
     RETURNING *, (SELECT question FROM polls WHERE polls.id = notifications.poll_id) AS poll_question`,
    [pollIds],
  );
  return rows;
}

/** Full read: poll question and, for invitations, the group and the inviter. */
const NOTIFICATION_SELECT = `
  SELECT n.*, p.question AS poll_question,
         CASE WHEN gi.id IS NULL THEN NULL ELSE json_build_object(
           'id', gi.id, 'status', gi.status, 'groupId', gi.conversation_id, 'groupName', c.name, 'invitedBy', iu.username)
         END AS invitation
    FROM notifications n
    LEFT JOIN polls p ON p.id = n.poll_id
    LEFT JOIN group_invitations gi ON gi.id = n.invitation_id
    LEFT JOIN conversations c ON c.id = gi.conversation_id
    LEFT JOIN users iu ON iu.id = gi.invited_by`;

export async function findNotificationsByIds(ids: string[]) {
  if (!ids.length) return [];
  const { rows } = await query<NotificationRow>(`${NOTIFICATION_SELECT} WHERE n.id = ANY($1::uuid[])`, [ids]);
  return rows;
}

export async function listNotifications(userId: string, opts: { unreadOnly: boolean; limit: number }) {
  const { rows } = await query<NotificationRow>(
    `${NOTIFICATION_SELECT}
      WHERE n.user_id = $1 ${opts.unreadOnly ? 'AND n.is_read = FALSE' : ''}
      ORDER BY n.created_at DESC LIMIT $2`,
    [userId, opts.limit],
  );
  const unread = await query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [userId],
  );
  return { notifications: rows.map(toNotification), unreadCount: unread.rows[0].n };
}

/** The user_id condition guarantees a user can only modify their own notifications. */
export async function markAsRead(userId: string, id: string) {
  const { rows } = await query<NotificationRow>(
    `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2
     RETURNING *, (SELECT question FROM polls WHERE polls.id = notifications.poll_id) AS poll_question`,
    [id, userId],
  );
  return rows[0] ? toNotification(rows[0]) : null;
}

export async function markAllAsRead(userId: string) {
  const { rowCount } = await query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE', [userId]);
  return rowCount ?? 0;
}
