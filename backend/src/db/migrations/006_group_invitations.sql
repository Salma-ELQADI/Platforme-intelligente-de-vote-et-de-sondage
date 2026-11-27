-- =====================================================================
-- 006 - Group invitations
-- Adding someone to a group no longer makes them a member directly: they
-- receive an invitation (and a notification) and join only if they accept.
-- =====================================================================

CREATE TABLE group_invitations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  status          VARCHAR(9)  NOT NULL DEFAULT 'PENDING',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at    TIMESTAMPTZ,

  CONSTRAINT group_invitations_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  CONSTRAINT group_invitations_response_consistency CHECK ((status = 'PENDING') = (responded_at IS NULL))
);

-- At most one pending invitation per person and group (a declined person can be invited again later).
CREATE UNIQUE INDEX group_invitations_one_pending_idx ON group_invitations (conversation_id, user_id) WHERE status = 'PENDING';
-- "My pending invitations".
CREATE INDEX group_invitations_user_idx ON group_invitations (user_id) WHERE status = 'PENDING';

-- The invitation is delivered as a notification that carries it.
ALTER TABLE notifications
  ADD COLUMN invitation_id UUID REFERENCES group_invitations(id) ON DELETE CASCADE,
  DROP CONSTRAINT notifications_type_check,
  ADD CONSTRAINT notifications_type_check CHECK (type IN ('POLL_CLOSED', 'POLL_OPENED', 'POLL_REMINDER', 'GROUP_INVITE')),
  ADD CONSTRAINT notifications_invitation_consistency CHECK ((type = 'GROUP_INVITE') = (invitation_id IS NOT NULL));
