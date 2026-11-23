export type PollStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
export type CreationMode = 'MANUAL' | 'AI';
export type ResultsVisibility = 'LIVE' | 'AFTER_CLOSE';

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
}

export interface PollRow {
  id: string;
  question: string;
  description: string | null;
  created_by: string;
  creation_mode: CreationMode;
  status: PollStatus;
  results_visibility: ResultsVisibility;
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
