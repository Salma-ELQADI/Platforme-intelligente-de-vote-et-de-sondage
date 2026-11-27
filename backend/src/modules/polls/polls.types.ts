export type PollStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'CLOSED';
export type VotingMethod = 'SINGLE' | 'MULTIPLE' | 'RANKED';
export type CreationMode = 'MANUAL' | 'AI';
export type ResultsVisibility = 'LIVE' | 'AFTER_CLOSE';
export type PollAccess = 'PUBLIC' | 'PRIVATE' | 'GROUP';

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
  /** First choice of the requesting user, or null if they have not voted. */
  myVoteOptionId: string | null;
  /** All choices of the requesting user, in rank order (empty if they have not voted). */
  myChoices: string[];
  votingMethod: VotingMethod;
  /** MULTIPLE polls: maximum number of answers per ballot. */
  maxChoices: number | null;
  /** Scheduled opening time (SCHEDULED polls), null when published immediately. */
  startsAt: string | null;
  /** PRIVATE/GROUP polls: remind non-voters this many minutes before closing. */
  remindBeforeMinutes: number | null;
  /** Whether the requesting user is allowed to vote (never the creator; invited users only if PRIVATE). */
  canVote: boolean;
  /** Invited voters of a PRIVATE poll: only returned to its creator and to admins, otherwise null. */
  voters: PollVoter[] | null;
  /** GROUP polls: the group conversation they belong to (only its members can see the poll). */
  group: { id: string; name: string } | null;
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
  group_id: string | null;
  voting_method: VotingMethod;
  max_choices: number | null;
  starts_at: Date | null;
  remind_before_minutes: number | null;
  reminder_sent_at: Date | null;
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
  /** SINGLE: votes. MULTIPLE: ballots that selected it. RANKED: first preferences. */
  votes: number;
  /** SINGLE/RANKED: share of the ballots. MULTIPLE: share of voters who selected it (sum can exceed 100). */
  percentage: number;
}

export interface RankedRound {
  round: number;
  tallies: { optionId: string; votes: number }[];
  activeBallots: number;
  exhaustedBallots: number;
  eliminated: string[];
}

/** Statistics computed from the rows stored in PostgreSQL (never from client counters). */
export interface PollResults {
  pollId: string;
  status: PollStatus;
  totalVotes: number;
  /** false when the poll hides its results until closure; `options` is then empty. */
  visible: boolean;
  method: VotingMethod;
  options: OptionResult[];
  /** RANKED polls: the instant-runoff count, round by round (empty when hidden). */
  rounds?: RankedRound[];
  /** RANKED polls: current winner(s) of the runoff. */
  winners?: string[];
  computedAt: string;
}
