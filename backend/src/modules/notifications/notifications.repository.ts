import { query, Queryable } from '../../db/pool';
import type { Notification, NotificationRow } from './notifications.types';

export const toNotification = (r: NotificationRow): Notification => ({
  id: r.id,
  type: r.type,
  message: r.message,
  pollId: r.poll_id,
  pollQuestion: r.poll_question,
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

export async function listNotifications(userId: string, opts: { unreadOnly: boolean; limit: number }) {
  const { rows } = await query<NotificationRow>(
    `SELECT n.*, p.question AS poll_question
       FROM notifications n LEFT JOIN polls p ON p.id = n.poll_id
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
