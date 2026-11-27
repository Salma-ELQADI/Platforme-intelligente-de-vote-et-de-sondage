// Types mirroring the backend API responses (see backend/src/modules/*/*.types.ts).

export type Role = "user" | "admin";
export type PollStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "CLOSED";
export type VotingMethod = "SINGLE" | "MULTIPLE" | "RANKED";
export type ResultsVisibility = "LIVE" | "AFTER_CLOSE";
export type CreationMode = "MANUAL" | "AI";
export type PollAccess = "PUBLIC" | "PRIVATE" | "GROUP";
export type Locale = "fr" | "en" | "ar";
export type ThemePreference = "system" | "light" | "dark";

export interface UserPreferences {
  locale: Locale | null;
  theme: ThemePreference;
  messageNotifications: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  preferences: UserPreferences;
}

export interface PollOption {
  id: string;
  text: string;
  position: number;
}

export interface Poll {
  id: string;
  question: string;
  description: string | null;
  status: PollStatus;
  isOpen: boolean;
  creationMode: CreationMode;
  resultsVisibility: ResultsVisibility;
  endTime: string;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; username: string };
  options: PollOption[];
  totalVotes: number;
  myVoteOptionId: string | null;
  /** All my choices, in rank order. */
  myChoices: string[];
  votingMethod: VotingMethod;
  maxChoices: number | null;
  startsAt: string | null;
  remindBeforeMinutes: number | null;
  access: PollAccess;
  /** false for the poll's creator, and for non-invited users of a private poll. */
  canVote: boolean;
  /** Invited voters of a private poll; only sent to its creator and to admins. */
  voters: PollVoter[] | null;
  /** GROUP polls: the group conversation whose members can see and vote. */
  group: { id: string; name: string } | null;
}

export interface PollVoter {
  id: string;
  username: string;
}

export interface OptionResult {
  optionId: string;
  text: string;
  position: number;
  votes: number;
  percentage: number;
}

export interface RankedRound {
  round: number;
  tallies: { optionId: string; votes: number }[];
  activeBallots: number;
  exhaustedBallots: number;
  eliminated: string[];
}

export interface PollResults {
  pollId: string;
  status: PollStatus;
  totalVotes: number;
  visible: boolean;
  method: VotingMethod;
  options: OptionResult[];
  rounds?: RankedRound[];
  winners?: string[];
  computedAt: string;
}

export interface PollSummary {
  pollId: string;
  locale: Locale;
  summary: string;
  model: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: "POLL_CLOSED" | "POLL_OPENED" | "POLL_REMINDER" | "GROUP_INVITE";
  message: string;
  pollId: string | null;
  pollQuestion: string | null;
  /** GROUP_INVITE: the invitation to accept or decline. */
  invitation: { id: string; status: InvitationStatus; groupId: string; groupName: string; invitedBy: string | null } | null;
  isRead: boolean;
  createdAt: string;
}

export interface VoteHistoryItem {
  id: string;
  votedAt: string;
  poll: { id: string; question: string; status: PollStatus; endTime: string; votingMethod: VotingMethod };
  option: { id: string; text: string };
  choices: { id: string; text: string; rank: number }[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface GeneratedPoll {
  question: string;
  options: string[];
  model: string;
}

export interface PollFormValues {
  question: string;
  description?: string | null;
  options: string[];
  endTime: string; // ISO string
  resultsVisibility: ResultsVisibility;
  creationMode?: CreationMode;
  access: PollAccess;
  /** Usernames or emails of the invited voters (private polls only). */
  voters: string[];
  /** Group conversation of a GROUP poll. */
  groupId?: string | null;
  votingMethod: VotingMethod;
  maxChoices?: number | null;
  /** ISO date of a scheduled opening, null to open on publication. */
  startsAt?: string | null;
  remindBeforeMinutes?: number | null;
}

// ---------------- Messaging ----------------

export type InvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED";

export interface GroupInvitation {
  id: string;
  status: InvitationStatus;
  group: { id: string; name: string; memberCount: number };
  invitedBy: { id: string; username: string } | null;
  createdAt: string;
}

export type ConversationType = "DIRECT" | "GROUP";
export type MemberRole = "ADMIN" | "MEMBER";

export interface ConversationMember {
  id: string;
  username: string;
  role: MemberRole;
  lastReadSeq: number;
  joinedAt: string;
  online: boolean;
}

export interface MessagePoll {
  id: string;
  question: string;
  status: PollStatus;
  endTime: string;
  optionCount: number;
}

export interface Message {
  id: string;
  kind: "TEXT" | "POLL";
  poll: MessagePoll | null;
  seq: number;
  conversationId: string;
  sender: { id: string; username: string } | null;
  body: string;
  clientId: string;
  createdAt: string;
}

/** Client-side state of a message being sent (never sent by the server). */
export interface PendingMessage {
  clientId: string;
  conversationId: string;
  body: string;
  createdAt: string;
  state: "sending" | "failed";
}

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  createdBy: string | null;
  myRole: MemberRole;
  myLastReadSeq: number;
  members: ConversationMember[];
  /** People invited to the group who have not answered yet. */
  invitations: { id: string; userId: string; username: string; createdAt: string }[];
  lastMessage: Message | null;
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}
