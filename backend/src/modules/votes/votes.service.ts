import { withTransaction, query } from '../../db/pool';
import { AppError, isPgError, notFound, PG_ERRORS } from '../../utils/errors';
import { broadcastResults } from '../../socket/realtime';
import { buildResults } from '../polls/polls.service';
import { countPollOptions, isGroupMember, isInvitedVoter, lockPoll } from '../polls/polls.repository';
import type { PollResults } from '../polls/polls.types';
import type { PublicUser } from '../users/users.types';

export interface CastVoteResult {
  vote: { id: string; pollId: string; optionId: string; optionIds: string[]; votedAt: string };
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
 *     a GROUP poll: the user is a current member of the group (author included)
 *  7. the choices fit the voting method    → SINGLE: 1 · MULTIPLE: 1..max_choices · RANKED: 1..n, no repeats
 *  8. every choice belongs to this poll    → explicit check + composite foreign keys
 *  9. the user has not voted yet           → UNIQUE (poll_id, user_id): one ballot, whatever the method
 *
 * FOR SHARE locks the poll row until COMMIT: a concurrent closure (UPDATE)
 * has to wait, so a vote can never be accepted "in the middle" of a closure.
 * The UNIQUE constraint resolves the race between two simultaneous votes of
 * the same user: PostgreSQL lets exactly one INSERT succeed.
 */
export async function castVote(user: PublicUser, pollId: string, optionIds: string[]): Promise<CastVoteResult> {
  const { vote, poll } = await withTransaction(async (tx) => {
    const poll = await lockPoll(tx, pollId, 'SHARE');
    if (!poll || poll.status === 'DRAFT') throw notFound('Sondage introuvable');
    if (poll.status === 'SCHEDULED') {
      if (poll.created_by !== user.id && user.role !== 'admin') throw notFound('Sondage introuvable');
      throw new AppError(409, 'POLL_NOT_STARTED', "Ce sondage n'est pas encore ouvert");
    }
    const invited = poll.access === 'PRIVATE' && (await isInvitedVoter(pollId, user.id, tx));
    // Same answer as GET /polls/:id: a private poll does not exist for people who are not invited.
    if (poll.access === 'PRIVATE' && !invited && poll.created_by !== user.id && user.role !== 'admin') {
      throw notFound('Sondage introuvable');
    }
    const member = poll.access === 'GROUP' && (await isGroupMember(poll.group_id!, user.id, tx));
    if (poll.access === 'GROUP' && !member && poll.created_by !== user.id && user.role !== 'admin') {
      throw notFound('Sondage introuvable');
    }
    if (poll.status === 'CLOSED' || poll.expired) {
      throw new AppError(403, 'POLL_CLOSED', 'Ce sondage est clôturé, il n’est plus possible de voter');
    }
    if (poll.access === 'GROUP' && !member) {
      throw new AppError(403, 'NOT_GROUP_MEMBER', 'Seuls les membres du groupe peuvent voter à ce sondage');
    }
    if (poll.created_by === user.id && poll.access !== 'GROUP') {
      throw new AppError(403, 'OWNER_CANNOT_VOTE', 'Vous ne pouvez pas voter à votre propre sondage');
    }
    if (poll.access === 'PRIVATE' && !invited) {
      throw new AppError(403, 'NOT_INVITED', "Ce sondage est privé : seuls les votants invités peuvent voter");
    }

    const max = poll.voting_method === 'SINGLE' ? 1 : poll.voting_method === 'MULTIPLE' ? poll.max_choices! : Infinity;
    if (new Set(optionIds).size !== optionIds.length) {
      throw new AppError(400, 'INVALID_CHOICES', 'Une proposition ne peut être choisie qu’une fois');
    }
    if (optionIds.length < 1 || optionIds.length > max) {
      throw new AppError(
        400,
        'INVALID_CHOICES',
        poll.voting_method === 'SINGLE' ? 'Choisissez une seule proposition' : `Choisissez entre 1 et ${max} propositions`,
      );
    }
    if ((await countPollOptions(tx, pollId, optionIds)) !== optionIds.length) {
      throw new AppError(400, 'INVALID_OPTION', "Cette proposition n'appartient pas à ce sondage");
    }

    try {
      // The ballot (first choice kept in votes.option_id), then its choices in rank order.
      const { rows } = await tx.query<{ id: string; voted_at: Date }>(
        `INSERT INTO votes (poll_id, user_id, option_id) VALUES ($1, $2, $3) RETURNING id, voted_at`,
        [pollId, user.id, optionIds[0]],
      );
      await tx.query(
        `INSERT INTO vote_choices (vote_id, poll_id, option_id, rank)
         SELECT $1, $2, c.option_id, c.rank FROM unnest($3::uuid[]) WITH ORDINALITY AS c(option_id, rank)`,
        [rows[0].id, pollId, optionIds],
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
    vote: { id: vote.id, pollId, optionId: optionIds[0], optionIds, votedAt: vote.voted_at.toISOString() },
    results: await buildResults(pollInfo, user),
  };
}

/** The authenticated user's voting history. */
export async function listMyVotes(user: PublicUser) {
  const { rows } = await query<{
    id: string; poll_id: string; option_id: string; voted_at: Date; voting_method: string;
    question: string; status: string; option_text: string; end_time: Date;
    choices: { id: string; text: string; rank: number }[];
  }>(
    `SELECT v.id, v.poll_id, v.option_id, v.voted_at, p.question, p.status, p.end_time, p.voting_method, o.option_text,
            (SELECT json_agg(json_build_object('id', co.id, 'text', co.option_text, 'rank', vc.rank) ORDER BY vc.rank)
               FROM vote_choices vc JOIN poll_options co ON co.id = vc.option_id
              WHERE vc.vote_id = v.id) AS choices
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
    poll: { id: r.poll_id, question: r.question, status: r.status, endTime: r.end_time.toISOString(), votingMethod: r.voting_method },
    option: { id: r.option_id, text: r.option_text },
    choices: r.choices ?? [{ id: r.option_id, text: r.option_text, rank: 1 }],
  }));
}
