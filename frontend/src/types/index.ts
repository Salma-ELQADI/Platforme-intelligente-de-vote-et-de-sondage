// Types mirroring the backend API responses (see backend/src/modules/*/*.types.ts).

export type Role = "user" | "admin";
export type PollStatus = "DRAFT" | "ACTIVE" | "CLOSED";
export type ResultsVisibility = "LIVE" | "AFTER_CLOSE";
export type CreationMode = "MANUAL" | "AI";

export interface User {
  id: string;
  username: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
}

export interface OptionResult {
  optionId: string;
  text: string;
  position: number;
  votes: number;
  percentage: number;
}

export interface PollResults {
  pollId: string;
  status: PollStatus;
  totalVotes: number;
  visible: boolean;
  options: OptionResult[];
  computedAt: string;
}

export interface Notification {
  id: string;
  type: "POLL_CLOSED";
  message: string;
  pollId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface VoteHistoryItem {
  id: string;
  votedAt: string;
  poll: { id: string; question: string; status: PollStatus; endTime: string };
  option: { id: string; text: string };
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
}
