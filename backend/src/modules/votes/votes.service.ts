import { withTransaction, query } from '../../db/pool';
import { AppError, isPgError, notFound, PG_ERRORS } from '../../utils/errors';
import { broadcastResults } from '../../socket/realtime';
import { buildResults } from '../polls/polls.service';
import { isInvitedVoter, lockPoll } from '../polls/polls.repository';
import type { PollResults } from '../polls/polls.types';
import type { PublicUser } from '../users/users.types';

export interface CastVoteResult {
  vote: { id: string; pollId: string; optionId: string; votedAt: string };
  results: PollResults;
}

/**
 * Records a vote. Every rule is enforced on the server, inside one transaction:
 *
 *  1. the user is authenticated            → `authenticate` middleware
 *  2. the poll exists (and is not a draft) → SELECT ... FOR SHARE
 *  3. the poll is ACTIVE                   → status check
 *  4. the end time has not passed          → compared with the DATABASE clock (now())
 *  5. the user is not the poll's creator   → ownership check
 *  6. a PRIVATE poll: the user is invited  → poll_voters lookup
 *  7. the option belongs to this poll      → explicit check + composite foreign key
 *  8. the user has not voted yet           → UNIQUE (poll_id, user_id)
 *
 * FOR SHARE locks the poll row until COMMIT: a concurrent closure (UPDATE)
 * has to wait, so a vote can never be accepted "in the middle" of a closure.
 * The UNIQUE constraint resolves the race between two simultaneous votes of
 * the same user: PostgreSQL lets exactly one INSERT succeed.
 */
export async function castVote(user: PublicUser, pollId: string, optionId: string): Promise<CastVoteResult> {
  const { vote, poll } = await withTransaction(async (tx) => {
    const poll = await lockPoll(tx, pollId, 'SHARE');
    if (!poll || poll.status === 'DRAFT') throw notFound('Sondage introuvable');
    const invited = poll.access === 'PRIVATE' && (await isInvitedVoter(pollId, user.id, tx));
    // Same answer as GET /polls/:id: a private poll does not exist for people who are not invited.
    if (poll.access === 'PRIVATE' && !invited && poll.created_by !== user.id && user.role !== 'admin') {
      throw notFound('Sondage introuvable');
    }
    if (poll.status === 'CLOSED' || poll.expired) {
      throw new AppError(403, 'POLL_CLOSED', 'Ce sondage est clôturé, il n’est plus possible de voter');
    }
    if (poll.created_by === user.id) {
      throw new AppError(403, 'OWNER_CANNOT_VOTE', 'Vous ne pouvez pas voter à votre propre sondage');
    }
    if (poll.access === 'PRIVATE' && !invited) {
      throw new AppError(403, 'NOT_INVITED', "Ce sondage est privé : seuls les votants invités peuvent voter");
    }

    const option = await tx.query('SELECT 1 FROM poll_options WHERE id = $1 AND poll_id = $2', [optionId, pollId]);
    if (option.rowCount === 0) {
      throw new AppError(400, 'INVALID_OPTION', "Cette proposition n'appartient pas à ce sondage");
    }

    try {
      const { rows } = await tx.query<{ id: string; voted_at: Date }>(
        `INSERT INTO votes (poll_id, user_id, option_id) VALUES ($1, $2, $3) RETURNING id, voted_at`,
        [pollId, user.id, optionId],
      );
      return { vote: rows[0], poll };
    } catch (err) {
      if (isPgError(err, PG_ERRORS.UNIQUE_VIOLATION) && err.constraint === 'votes_one_per_user_per_poll') {
        throw new AppError(409, 'ALREADY_VOTED', 'Vous avez déjà voté pour ce sondage');
      }
      if (isPgError(err, PG_ERRORS.FOREIGN_KEY_VIOLATION)) {
        throw new AppError(400, 'INVALID_OPTION', "Cette proposition n'appartient pas à ce sondage");
      }
      throw err;
    }
  });

  // ---- The transaction is COMMITTED at this point: the vote is durable. ----
  // Results are recomputed from the database and broadcast to the poll's room.
  const pollInfo = { id: poll.id, status: poll.status, resultsVisibility: poll.results_visibility, creatorId: poll.created_by };
  const publicResults = await buildResults(pollInfo, null);
  broadcastResults(publicResults);

  return {
    vote: { id: vote.id, pollId, optionId, votedAt: vote.voted_at.toISOString() },
    results: await buildResults(pollInfo, user),
  };
}

/** The authenticated user's voting history. */
export async function listMyVotes(user: PublicUser) {
  const { rows } = await query<{
    id: string; poll_id: string; option_id: string; voted_at: Date;
    question: string; status: string; option_text: string; end_time: Date;
  }>(
    `SELECT v.id, v.poll_id, v.option_id, v.voted_at, p.question, p.status, p.end_time, o.option_text
       FROM votes v
       JOIN polls p        ON p.id = v.poll_id
       JOIN poll_options o ON o.id = v.option_id
      WHERE v.user_id = $1
      ORDER BY v.voted_at DESC`,
    [user.id],
  );
  return rows.map((r) => ({
    id: r.id,
    votedAt: r.voted_at.toISOString(),
    poll: { id: r.poll_id, question: r.question, status: r.status, endTime: r.end_time.toISOString() },
    option: { id: r.option_id, text: r.option_text },
  }));
}
