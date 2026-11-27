export interface Notification {
  id: string;
  type: 'POLL_CLOSED';
  message: string;
  pollId: string | null;
  /** Lets the client word the notice in the reader's language (message is the French text). */
  pollQuestion: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  poll_id: string | null;
  type: 'POLL_CLOSED';
  message: string;
  poll_question: string | null;
  is_read: boolean;
  created_at: Date;
}
