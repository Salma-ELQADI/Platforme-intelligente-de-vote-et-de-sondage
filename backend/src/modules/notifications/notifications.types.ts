export interface Notification {
  id: string;
  type: 'POLL_CLOSED';
  message: string;
  pollId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  poll_id: string | null;
  type: 'POLL_CLOSED';
  message: string;
  is_read: boolean;
  created_at: Date;
}
