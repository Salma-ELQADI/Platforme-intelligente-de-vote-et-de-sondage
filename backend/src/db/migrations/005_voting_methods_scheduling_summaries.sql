-- =====================================================================
-- 005 - Voting methods, scheduled polls, reminders, AI result summaries
--
-- 1. Polls can be SINGLE choice (as before), MULTIPLE choice (up to
--    max_choices answers) or RANKED (voters order the answers; the winner
--    is computed by instant runoff).
-- 2. A poll can be published with a future start time (status SCHEDULED)
--    and can remind its eligible voters who have not voted yet.
-- 3. The AI summary of a closed poll is cached per language.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Voting methods
-- ---------------------------------------------------------------------
ALTER TABLE polls
  ADD COLUMN voting_method VARCHAR(8) NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN max_choices   SMALLINT,
  ADD CONSTRAINT polls_voting_method_check CHECK (voting_method IN ('SINGLE', 'MULTIPLE', 'RANKED')),
  -- max_choices is required for MULTIPLE polls, and only for them.
  ADD CONSTRAINT polls_max_choices_check CHECK (
    (voting_method = 'MULTIPLE') = (max_choices IS NOT NULL) AND (max_choices IS NULL OR max_choices BETWEEN 2 AND 10)
  );

-- A ballot is still ONE row of "votes" per user and poll: the UNIQUE
-- (poll_id, user_id) constraint keeps guaranteeing "one ballot per person"
-- for every voting method. votes.option_id keeps the first choice.
-- Needed as the target of the composite foreign key below.
ALTER TABLE votes ADD CONSTRAINT votes_id_poll_unique UNIQUE (id, poll_id);

-- The answers of a ballot: one row per chosen option, with its rank
-- (1 for single choice; 1..n in order of preference for ranked ballots;
-- 1..n in the order clicked for multiple choice, where the rank carries no meaning).
CREATE TABLE vote_choices (
  vote_id   UUID     NOT NULL,
  poll_id   UUID     NOT NULL,
  option_id UUID     NOT NULL,
  rank      SMALLINT NOT NULL,

  CONSTRAINT vote_choices_pkey        PRIMARY KEY (vote_id, option_id), -- an option at most once per ballot
  CONSTRAINT vote_choices_rank_unique UNIQUE (vote_id, rank),           -- one option per rank
  CONSTRAINT vote_choices_rank_check  CHECK (rank >= 1),
  -- Both composite keys pin the same poll_id: a choice can only reference an
  -- option of the poll its ballot belongs to.
  CONSTRAINT vote_choices_vote_fk   FOREIGN KEY (vote_id, poll_id)   REFERENCES votes (id, poll_id) ON DELETE CASCADE,
  CONSTRAINT vote_choices_option_fk FOREIGN KEY (option_id, poll_id) REFERENCES poll_options (id, poll_id) ON DELETE CASCADE
);

-- Results: "count choices per option of a poll".
CREATE INDEX vote_choices_poll_option_idx ON vote_choices (poll_id, option_id);

-- Existing single-choice ballots become one choice of rank 1.
INSERT INTO vote_choices (vote_id, poll_id, option_id, rank)
SELECT id, poll_id, option_id, 1 FROM votes;

-- ---------------------------------------------------------------------
-- 2. Scheduled opening and reminders
-- Lifecycle: DRAFT -> (SCHEDULED) -> ACTIVE -> CLOSED
-- ---------------------------------------------------------------------
ALTER TABLE polls
  ADD COLUMN starts_at             TIMESTAMPTZ,
  ADD COLUMN remind_before_minutes INTEGER,
  ADD COLUMN reminder_sent_at      TIMESTAMPTZ,
  DROP CONSTRAINT polls_status_check,
  ADD CONSTRAINT polls_status_check CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED')),
  -- published_at is the moment voting actually opened.
  DROP CONSTRAINT polls_published_consistency,
  ADD CONSTRAINT polls_published_consistency CHECK (status IN ('DRAFT', 'SCHEDULED') OR published_at IS NOT NULL),
  ADD CONSTRAINT polls_scheduled_consistency CHECK (status <> 'SCHEDULED' OR starts_at IS NOT NULL),
  ADD CONSTRAINT polls_starts_before_end     CHECK (starts_at IS NULL OR starts_at < end_time),
  -- Reminders target a known list of voters: invited voters or group members.
  ADD CONSTRAINT polls_reminder_check CHECK (
    remind_before_minutes IS NULL OR (remind_before_minutes BETWEEN 5 AND 10080 AND access <> 'PUBLIC')
  );

-- Partial indexes scanned by the background job: only rows with work to do.
CREATE INDEX polls_scheduled_start_idx ON polls (starts_at) WHERE status = 'SCHEDULED';
CREATE INDEX polls_pending_reminder_idx ON polls (end_time)
  WHERE status = 'ACTIVE' AND remind_before_minutes IS NOT NULL AND reminder_sent_at IS NULL;

ALTER TABLE notifications
  DROP CONSTRAINT notifications_type_check,
  ADD CONSTRAINT notifications_type_check CHECK (type IN ('POLL_CLOSED', 'POLL_OPENED', 'POLL_REMINDER'));

-- ---------------------------------------------------------------------
-- 3. AI summaries of closed polls (results never change after closure,
--    so one summary per language can be kept forever)
-- ---------------------------------------------------------------------
CREATE TABLE poll_summaries (
  poll_id     UUID          NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  locale      VARCHAR(2)    NOT NULL,
  summary     VARCHAR(1200) NOT NULL,
  model       VARCHAR(100)  NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT poll_summaries_pkey         PRIMARY KEY (poll_id, locale),
  CONSTRAINT poll_summaries_locale_check CHECK (locale IN ('fr', 'en', 'ar'))
);
