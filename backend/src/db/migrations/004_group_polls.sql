-- =====================================================================
-- 004 - Group polls
-- A GROUP poll ("Where do we go this weekend?", "Should the cafeteria be
-- larger?") belongs to a group conversation: only the group's current
-- members can read it and vote, its author included. Publishing it posts a
-- POLL message in the group's chat.
-- =====================================================================

ALTER TABLE polls
  DROP CONSTRAINT polls_access_check,
  ADD CONSTRAINT polls_access_check CHECK (access IN ('PUBLIC', 'PRIVATE', 'GROUP')),
  -- Deleting the group (its last member left) deletes its polls: nobody could see them any more.
  ADD COLUMN group_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  ADD CONSTRAINT polls_group_consistency CHECK ((access = 'GROUP') = (group_id IS NOT NULL));

CREATE INDEX polls_group_idx ON polls (group_id, created_at DESC) WHERE group_id IS NOT NULL;

-- Chat messages can now be a poll announcement.
ALTER TABLE messages
  ADD COLUMN kind    VARCHAR(4) NOT NULL DEFAULT 'TEXT',
  ADD COLUMN poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  ADD CONSTRAINT messages_kind_check CHECK (kind IN ('TEXT', 'POLL')),
  ADD CONSTRAINT messages_poll_consistency CHECK ((kind = 'POLL') = (poll_id IS NOT NULL)),
  -- A poll is announced once per group, even if publishing were retried.
  ADD CONSTRAINT messages_poll_unique UNIQUE (poll_id);
