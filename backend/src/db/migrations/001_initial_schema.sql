-- =====================================================================
-- 001 - Initial schema for VoteLive
-- users, polls, poll_options, votes, notifications
-- =====================================================================

-- gen_random_uuid() is built into PostgreSQL >= 13 (pgcrypto not needed).

-- Shared trigger function: keeps updated_at in sync on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(30)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'user',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT users_role_check       CHECK (role IN ('user', 'admin')),
  CONSTRAINT users_username_length  CHECK (char_length(username) BETWEEN 3 AND 30),
  -- Emails are normalised to lower case by the application; the check makes
  -- it impossible to bypass the UNIQUE constraint with "Bob@x.com" vs "bob@x.com".
  CONSTRAINT users_email_lowercase  CHECK (email = lower(email)),
  CONSTRAINT users_email_unique     UNIQUE (email),
  CONSTRAINT users_username_unique  UNIQUE (username)
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- polls
-- Lifecycle: DRAFT -> ACTIVE -> CLOSED
-- ---------------------------------------------------------------------
CREATE TABLE polls (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question           VARCHAR(300) NOT NULL,
  description        VARCHAR(1000),
  created_by         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creation_mode      VARCHAR(10)  NOT NULL DEFAULT 'MANUAL',
  status             VARCHAR(10)  NOT NULL DEFAULT 'DRAFT',
  results_visibility VARCHAR(12)  NOT NULL DEFAULT 'LIVE',
  end_time           TIMESTAMPTZ  NOT NULL,
  published_at       TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT polls_creation_mode_check CHECK (creation_mode IN ('MANUAL', 'AI')),
  CONSTRAINT polls_status_check        CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  CONSTRAINT polls_visibility_check    CHECK (results_visibility IN ('LIVE', 'AFTER_CLOSE')),
  CONSTRAINT polls_question_not_blank  CHECK (char_length(btrim(question)) >= 5),
  -- State consistency: timestamps must match the status.
  CONSTRAINT polls_published_consistency CHECK (status = 'DRAFT' OR published_at IS NOT NULL),
  CONSTRAINT polls_closed_consistency    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

CREATE INDEX polls_created_by_idx ON polls (created_by, created_at DESC);
CREATE INDEX polls_status_created_idx ON polls (status, created_at DESC);
-- Partial index used by the closure scheduler: only ACTIVE polls are scanned.
CREATE INDEX polls_active_end_time_idx ON polls (end_time) WHERE status = 'ACTIVE';

CREATE TRIGGER polls_set_updated_at
  BEFORE UPDATE ON polls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- poll_options (variable number of answers per poll)
-- ---------------------------------------------------------------------
CREATE TABLE poll_options (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     UUID         NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_text VARCHAR(200) NOT NULL,
  position    SMALLINT     NOT NULL,

  CONSTRAINT poll_options_text_not_blank CHECK (char_length(btrim(option_text)) >= 1),
  CONSTRAINT poll_options_position_check CHECK (position >= 0),
  CONSTRAINT poll_options_position_unique UNIQUE (poll_id, position),
  -- Needed as the target of the composite foreign key in "votes".
  CONSTRAINT poll_options_id_poll_unique UNIQUE (id, poll_id)
);

-- Two options of the same poll cannot have the same text (case-insensitive).
CREATE UNIQUE INDEX poll_options_text_unique_idx ON poll_options (poll_id, lower(option_text));

-- ---------------------------------------------------------------------
-- votes
-- ---------------------------------------------------------------------
CREATE TABLE votes (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id   UUID        NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id UUID        NOT NULL,
  voted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One vote per user and per poll, enforced by the database itself.
  CONSTRAINT votes_one_per_user_per_poll UNIQUE (poll_id, user_id),
  -- Composite FK: the chosen option MUST belong to the same poll.
  CONSTRAINT votes_option_belongs_to_poll
    FOREIGN KEY (option_id, poll_id) REFERENCES poll_options (id, poll_id) ON DELETE CASCADE
);

-- Speeds up "COUNT votes GROUP BY option" for a given poll.
CREATE INDEX votes_poll_option_idx ON votes (poll_id, option_id);
-- Speeds up "my voting history".
CREATE INDEX votes_user_idx ON votes (user_id, voted_at DESC);

-- ---------------------------------------------------------------------
-- notifications (persisted so offline users see them later)
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poll_id    UUID         REFERENCES polls(id) ON DELETE CASCADE,
  type       VARCHAR(20)  NOT NULL,
  message    VARCHAR(500) NOT NULL,
  is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT notifications_type_check CHECK (type IN ('POLL_CLOSED')),
  -- Idempotency: a user is notified at most once per poll closure.
  CONSTRAINT notifications_unique_per_event UNIQUE (user_id, poll_id, type)
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
