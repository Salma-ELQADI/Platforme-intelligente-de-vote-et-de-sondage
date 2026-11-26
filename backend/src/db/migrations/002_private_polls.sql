-- =====================================================================
-- 002 - Private polls
-- A PRIVATE poll is only visible to, and can only be voted on by, the
-- users invited by its creator (listed in poll_voters).
-- =====================================================================

ALTER TABLE polls
  ADD COLUMN access VARCHAR(10) NOT NULL DEFAULT 'PUBLIC',
  ADD CONSTRAINT polls_access_check CHECK (access IN ('PUBLIC', 'PRIVATE'));

CREATE TABLE poll_voters (
  poll_id  UUID        NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT poll_voters_pkey PRIMARY KEY (poll_id, user_id)
);

-- Speeds up "the private polls I am invited to".
CREATE INDEX poll_voters_user_idx ON poll_voters (user_id);
