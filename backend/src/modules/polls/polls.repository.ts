import { pool, query, Queryable } from '../../db/pool';
import { instantRunoff } from './rankedChoice';
import type { OptionResult, Poll, PollAccess, PollRow, PollStatus, PollVoter, RankedRound, VotingMethod } from './polls.types';

/**
 * Base SELECT used by every read: poll + creator + options (as a JSON array)
 * + total votes + the requesting user's vote. One round trip per page,
 * no N+1 queries. $1 is always the id of the requesting user.
 */
/** true when the requesting user ($1) is on the invited voters list of poll p. */
const IS_INVITED = 'EXISTS (SELECT 1 FROM poll_voters pv WHERE pv.poll_id = p.id AND pv.user_id = $1)';

/** true when the requesting user ($1) currently belongs to the group of a GROUP poll. */
const IS_GROUP_MEMBER =
  'EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = p.group_id AND cm.user_id = $1)';

/**
 * Rows the requesting user ($1) may see in lists: public polls, their own,
 * private polls they are invited to, and polls of the groups they belong to.
 */
const VISIBLE_TO_VIEWER = `(p.access = 'PUBLIC' OR p.created_by = $1
  OR (p.access = 'PRIVATE' AND ${IS_INVITED}) OR (p.access = 'GROUP' AND ${IS_GROUP_MEMBER}))`;

const POLL_SELECT = `
  SELECT p.*,
         u.username AS creator_username,
         (p.status = 'ACTIVE' AND p.end_time > now()) AS is_open,
         COALESCE(
           (SELECT json_agg(json_build_object('id', o.id, 'text', o.option_text, 'position', o.position)
                            ORDER BY o.position)
              FROM poll_options o WHERE o.poll_id = p.id),
           '[]'::json) AS options,
         (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id)::int AS total_votes,
         (SELECT v.option_id FROM votes v WHERE v.poll_id = p.id AND v.user_id = $1) AS my_vote_option_id,
         (SELECT COALESCE(array_agg(vc.option_id ORDER BY vc.rank), '{}')
            FROM votes v JOIN vote_choices vc ON vc.vote_id = v.id
           WHERE v.poll_id = p.id AND v.user_id = $1) AS my_choices,
         g.name AS group_name,
         -- Group polls are a group decision: every current member votes, the author included.
         CASE WHEN p.access = 'GROUP' THEN ${IS_GROUP_MEMBER}
              ELSE (p.created_by <> $1 AND (p.access = 'PUBLIC' OR ${IS_INVITED})) END AS can_vote
    FROM polls p
    JOIN users u ON u.id = p.created_by
    LEFT JOIN conversations g ON g.id = p.group_id`;

type FullPollRow = PollRow & {
  creator_username: string;
  is_open: boolean;
  options: Poll['options'];
  total_votes: number;
  my_vote_option_id: string | null;
  my_choices: string[];
  can_vote: boolean;
  group_name: string | null;
};

function toPoll(r: FullPollRow): Poll {
  return {
    id: r.id,
    question: r.question,
    description: r.description,
    status: r.status,
    isOpen: r.is_open,
    creationMode: r.creation_mode,
    resultsVisibility: r.results_visibility,
    access: r.access,
    endTime: r.end_time.toISOString(),
    publishedAt: r.published_at?.toISOString() ?? null,
    closedAt: r.closed_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    creator: { id: r.created_by, username: r.creator_username },
    options: r.options,
    totalVotes: r.total_votes,
    myVoteOptionId: r.my_vote_option_id,
    myChoices: r.my_choices,
    votingMethod: r.voting_method,
    maxChoices: r.max_choices,
    startsAt: r.starts_at?.toISOString() ?? null,
    remindBeforeMinutes: r.remind_before_minutes,
    canVote: r.can_vote,
    voters: null,
    group: r.group_id ? { id: r.group_id, name: r.group_name ?? '' } : null,
  };
}

export async function findPollById(id: string, viewerId: string, db: Queryable = pool): Promise<Poll | null> {
  const { rows } = await db.query<FullPollRow>(`${POLL_SELECT} WHERE p.id = $2`, [viewerId, id]);
  return rows[0] ? toPoll(rows[0]) : null;
}

/**
 * Locks the poll row for the rest of the current transaction.
 * FOR UPDATE: exclusive (used before modifying the poll).
 * FOR SHARE: allows other readers/voters but blocks modifications (used when voting).
 */
export async function lockPoll(db: Queryable, id: string, mode: 'UPDATE' | 'SHARE') {
  const { rows } = await db.query<PollRow & { expired: boolean }>(
    `SELECT *, end_time <= now() AS expired FROM polls WHERE id = $1 FOR ${mode === 'UPDATE' ? 'UPDATE' : 'SHARE'}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listPublicPolls(viewerId: string, q: { status: PollStatus; search?: string; limit: number; offset: number }) {
  const params: unknown[] = [viewerId, q.status, q.limit, q.offset];
  let searchClause = '';
  if (q.search) {
    params.push(`%${q.search}%`);
    searchClause = 'AND p.question ILIKE $5';
  }
  // ACTIVE list: soonest closing first. CLOSED list: most recently closed first.
  const order = q.status === 'ACTIVE' ? 'p.end_time ASC' : 'p.closed_at DESC';
  const [{ rows }, count] = await Promise.all([
    query<FullPollRow>(
      `${POLL_SELECT} WHERE p.status = $2 AND ${VISIBLE_TO_VIEWER} ${searchClause} ORDER BY ${order} LIMIT $3 OFFSET $4`,
      params,
    ),
    query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM polls p
        WHERE p.status = $2 AND ${VISIBLE_TO_VIEWER} ${q.search ? 'AND p.question ILIKE $3' : ''}`,
      q.search ? [viewerId, q.status, `%${q.search}%`] : [viewerId, q.status],
    ),
  ]);
  return { polls: rows.map(toPoll), total: count.rows[0].total };
}

export async function listPollsByCreator(userId: string, status?: PollStatus) {
  const params: unknown[] = [userId];
  let statusClause = '';
  if (status) {
    params.push(status);
    statusClause = 'AND p.status = $2';
  }
  const { rows } = await query<FullPollRow>(
    `${POLL_SELECT} WHERE p.created_by = $1 ${statusClause} ORDER BY p.created_at DESC`,
    params,
  );
  return rows.map(toPoll);
}

export async function insertPoll(
  db: Queryable,
  data: {
    question: string; description?: string | null; createdBy: string; creationMode: string;
    resultsVisibility: string; access: PollAccess; endTime: Date; groupId: string | null;
    votingMethod: VotingMethod; maxChoices: number | null; startsAt: Date | null; remindBeforeMinutes: number | null;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO polls (question, description, created_by, creation_mode, results_visibility, access, end_time, group_id,
                        voting_method, max_choices, starts_at, remind_before_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      data.question, data.description ?? null, data.createdBy, data.creationMode, data.resultsVisibility, data.access, data.endTime,
      data.groupId, data.votingMethod, data.maxChoices, data.startsAt, data.remindBeforeMinutes,
    ],
  );
  return rows[0].id;
}

/** Inserts all options in a single statement using unnest() on two parallel arrays. */
export async function insertOptions(db: Queryable, pollId: string, options: string[]) {
  await db.query(
    `INSERT INTO poll_options (poll_id, option_text, position)
     SELECT $1, t.text, t.pos FROM unnest($2::text[], $3::smallint[]) AS t(text, pos)`,
    [pollId, options, options.map((_, i) => i)],
  );
}

export async function replaceOptions(db: Queryable, pollId: string, options: string[]) {
  await db.query('DELETE FROM poll_options WHERE poll_id = $1', [pollId]);
  await insertOptions(db, pollId, options);
}

export async function updatePollFields(
  db: Queryable,
  id: string,
  data: {
    question?: string; description?: string | null; endTime?: Date; resultsVisibility?: string;
    access?: PollAccess; groupId?: string | null;
    votingMethod?: VotingMethod; maxChoices?: number | null; startsAt?: Date | null; remindBeforeMinutes?: number | null;
  },
) {
  await db.query(
    `UPDATE polls SET
       question           = COALESCE($2, question),
       description        = CASE WHEN $3::boolean THEN $4 ELSE description END,
       end_time           = COALESCE($5, end_time),
       results_visibility = COALESCE($6, results_visibility),
       access             = COALESCE($7, access),
       group_id           = CASE WHEN $8::boolean THEN $9::uuid ELSE group_id END,
       voting_method      = COALESCE($10, voting_method),
       max_choices        = CASE WHEN $11::boolean THEN $12::smallint ELSE max_choices END,
       starts_at          = CASE WHEN $13::boolean THEN $14::timestamptz ELSE starts_at END,
       remind_before_minutes = CASE WHEN $15::boolean THEN $16::integer ELSE remind_before_minutes END
     WHERE id = $1`,
    [
      id,
      data.question ?? null,
      data.description !== undefined,
      data.description ?? null,
      data.endTime ?? null,
      data.resultsVisibility ?? null,
      data.access ?? null,
      data.groupId !== undefined,
      data.groupId ?? null,
      data.votingMethod ?? null,
      data.maxChoices !== undefined,
      data.maxChoices ?? null,
      data.startsAt !== undefined,
      data.startsAt ?? null,
      data.remindBeforeMinutes !== undefined,
      data.remindBeforeMinutes ?? null,
    ],
  );
}

/** Polls of one group, newest first: published ones, plus the viewer's own drafts. */
export async function listGroupPolls(viewerId: string, groupId: string) {
  const { rows } = await query<FullPollRow>(
    `${POLL_SELECT} WHERE p.group_id = $2 AND (p.status <> 'DRAFT' OR p.created_by = $1) ORDER BY p.created_at DESC LIMIT 100`,
    [viewerId, groupId],
  );
  return rows.map(toPoll);
}

export async function isGroupMember(groupId: string, userId: string, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = $1 AND m.user_id = $2 AND c.type = 'GROUP'`,
    [groupId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** Replaces the whole invited voters list of a poll. */
export async function replaceVoters(db: Queryable, pollId: string, userIds: string[]) {
  await db.query('DELETE FROM poll_voters WHERE poll_id = $1', [pollId]);
  if (userIds.length === 0) return;
  await db.query(
    `INSERT INTO poll_voters (poll_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [pollId, userIds],
  );
}

export async function listVoters(pollId: string, db: Queryable = pool): Promise<PollVoter[]> {
  const { rows } = await db.query<PollVoter>(
    `SELECT u.id, u.username FROM poll_voters pv JOIN users u ON u.id = pv.user_id
      WHERE pv.poll_id = $1 ORDER BY u.username`,
    [pollId],
  );
  return rows;
}

export async function countVoters(db: Queryable, pollId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM poll_voters WHERE poll_id = $1', [pollId]);
  return rows[0].n;
}

export async function isInvitedVoter(pollId: string, userId: string, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM poll_voters WHERE poll_id = $1 AND user_id = $2', [pollId, userId]);
  return (rowCount ?? 0) > 0;
}

export async function countOptions(db: Queryable, pollId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM poll_options WHERE poll_id = $1', [pollId]);
  return rows[0].n;
}

export async function setPollActive(db: Queryable, id: string) {
  await db.query(`UPDATE polls SET status = 'ACTIVE', published_at = now() WHERE id = $1`, [id]);
}

export async function setPollStatus(db: Queryable, id: string, status: 'DRAFT' | 'SCHEDULED') {
  await db.query('UPDATE polls SET status = $2 WHERE id = $1', [id, status]);
}

/** Validates the choices of a ballot belong to the poll (returns how many do). */
export async function countPollOptions(db: Queryable, pollId: string, optionIds: string[]) {
  const { rows } = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM poll_options WHERE poll_id = $1 AND id = ANY($2::uuid[])', [
    pollId,
    optionIds,
  ]);
  return rows[0].n;
}

export async function deletePoll(db: Queryable, id: string) {
  await db.query('DELETE FROM polls WHERE id = $1', [id]);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Results computed from the stored ballots (never from client counters):
 *  - SINGLE:   votes per option / ballots;
 *  - MULTIPLE: ballots selecting each option / ballots ("x % of voters", the sum can exceed 100);
 *  - RANKED:   first preferences per option, plus the instant-runoff count round by round.
 * Options with no vote are included (LEFT JOIN).
 */
export async function computeResults(
  pollId: string,
  db: Queryable = pool,
): Promise<{ totalVotes: number; options: OptionResult[]; method: VotingMethod; rounds?: RankedRound[]; winners?: string[] }> {
  const [{ rows: meta }, { rows }] = await Promise.all([
    db.query<{ voting_method: VotingMethod; ballots: number }>(
      'SELECT voting_method, (SELECT COUNT(*) FROM votes WHERE poll_id = $1)::int AS ballots FROM polls WHERE id = $1',
      [pollId],
    ),
    db.query<{ id: string; option_text: string; position: number; votes: number }>(
      `SELECT o.id, o.option_text, o.position,
              COUNT(vc.vote_id) FILTER (WHERE p.voting_method <> 'RANKED' OR vc.rank = 1)::int AS votes
         FROM poll_options o
         JOIN polls p ON p.id = o.poll_id
         LEFT JOIN vote_choices vc ON vc.option_id = o.id
        WHERE o.poll_id = $1
        GROUP BY o.id
        ORDER BY o.position`,
      [pollId],
    ),
  ]);
  const method = meta[0]?.voting_method ?? 'SINGLE';
  const totalVotes = meta[0]?.ballots ?? 0;
  const options = rows.map((r) => ({
    optionId: r.id,
    text: r.option_text,
    position: r.position,
    votes: r.votes,
    // One decimal place; 0 when nobody has voted yet (avoids division by zero).
    percentage: totalVotes === 0 ? 0 : round1((r.votes / totalVotes) * 100),
  }));
  if (method !== 'RANKED') return { totalVotes, options, method };

  const { rows: ballots } = await db.query<{ choices: string[] }>(
    `SELECT array_agg(vc.option_id ORDER BY vc.rank) AS choices
       FROM votes v JOIN vote_choices vc ON vc.vote_id = v.id
      WHERE v.poll_id = $1
      GROUP BY v.id`,
    [pollId],
  );
  const { rounds, winners } = instantRunoff(
    options.map((o) => o.optionId),
    ballots.map((b) => b.choices),
  );
  return { totalVotes, options, method, rounds, winners };
}
