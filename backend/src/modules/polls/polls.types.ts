export type PollStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
export type CreationMode = 'MANUAL' | 'AI';
export type ResultsVisibility = 'LIVE' | 'AFTER_CLOSE';
export type PollAccess = 'PUBLIC' | 'PRIVATE';

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
  /** true only if status is ACTIVE *and* the end time has not passed yet. */
  isOpen: boolean;
  creationMode: CreationMode;
  resultsVisibility: ResultsVisibility;
  /** PRIVATE: only the invited voters (plus the creator and admins) can see it. */
  access: PollAccess;
  endTime: string;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; username: string };
  options: PollOption[];
  totalVotes: number;
  /** Option chosen by the requesting user, or null if they have not voted. */
  myVoteOptionId: string | null;
  /** Whether the requesting user is allowed to vote (never the creator; invited users only if PRIVATE). */
  canVote: boolean;
  /** Invited voters of a PRIVATE poll: only returned to its creator and to admins, otherwise null. */
  voters: PollVoter[] | null;
}

export interface PollVoter {
  id: string;
  username: string;
}

export interface PollRow {
  id: string;
  question: string;
  description: string | null;
  created_by: string;
  creation_mode: CreationMode;
  status: PollStatus;
  results_visibility: ResultsVisibility;
  access: PollAccess;
  end_time: Date;
  published_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OptionResult {
  optionId: string;
  text: string;
  position: number;
  votes: number;
  percentage: number;
}

/** Statistics computed from the rows stored in PostgreSQL (never from client counters). */
export interface PollResults {
  pollId: string;
  status: PollStatus;
  totalVotes: number;
  /** false when the poll hides its results until closure; `options` is then empty. */
  visible: boolean;
  options: OptionResult[];
  computedAt: string;
}
