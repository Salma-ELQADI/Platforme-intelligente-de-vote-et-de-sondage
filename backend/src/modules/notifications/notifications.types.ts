export type NotificationType = 'POLL_CLOSED' | 'POLL_OPENED' | 'POLL_REMINDER' | 'GROUP_INVITE';

/** GROUP_INVITE notifications: the invitation to accept or decline. */
export interface NotificationInvitation {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  groupId: string;
  groupName: string;
  invitedBy: string | null;
}

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  pollId: string | null;
  /** Lets the client word the notice in the reader's language (message is the French text). */
  pollQuestion: string | null;
  invitation: NotificationInvitation | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  poll_id: string | null;
  type: NotificationType;
  message: string;
  poll_question: string | null;
  invitation?: NotificationInvitation | null;
  is_read: boolean;
  created_at: Date;
}
