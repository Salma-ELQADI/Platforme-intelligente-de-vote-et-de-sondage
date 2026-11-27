export type ConversationType = 'DIRECT' | 'GROUP';
export type MemberRole = 'ADMIN' | 'MEMBER';

export interface ConversationMember {
  id: string;
  username: string;
  role: MemberRole;
  /** seq of the last message this member has read: drives read receipts. */
  lastReadSeq: number;
  joinedAt: string;
  /** Live presence (at least one open socket). */
  online: boolean;
}

export type MessageKind = 'TEXT' | 'POLL';

/** Snapshot of the poll announced by a POLL message (its live state is on the poll page). */
export interface MessagePoll {
  id: string;
  question: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  endTime: string;
  optionCount: number;
}

export interface Message {
  id: string;
  /** TEXT: a typed message. POLL: a group poll announcement (body = the question). */
  kind: MessageKind;
  poll: MessagePoll | null;
  /** Ordering key, strictly increasing across the whole platform. */
  seq: number;
  conversationId: string;
  /** null when the author's account has been deleted. */
  sender: { id: string; username: string } | null;
  body: string;
  /** Id chosen by the sending client, echoed back so it can reconcile its optimistic copy. */
  clientId: string;
  createdAt: string;
}

/** A conversation as seen by one of its members. */
export interface Conversation {
  id: string;
  type: ConversationType;
  /** Group name; null for a direct conversation (the UI shows the other member's name). */
  name: string | null;
  createdBy: string | null;
  myRole: MemberRole;
  myLastReadSeq: number;
  members: ConversationMember[];
  lastMessage: Message | null;
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  seq: string; // BIGINT comes back as a string from node-postgres
  conversation_id: string;
  sender_id: string | null;
  sender_username: string | null;
  body: string;
  client_id: string;
  created_at: Date;
  kind: MessageKind;
  poll: MessagePoll | null;
}

export interface ConversationRow {
  id: string;
  type: ConversationType;
  name: string | null;
  created_by: string | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
  my_role: MemberRole;
  my_last_read_seq: string;
  unread_count: number;
  members: { id: string; username: string; role: MemberRole; lastReadSeq: number; joinedAt: string }[];
  last_message: (Omit<MessageRow, 'seq' | 'created_at'> & { seq: number; created_at: string }) | null;
}
