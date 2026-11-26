import type { PoolClient } from 'pg';
import { withTransaction } from '../../db/pool';
import { logger } from '../../config/logger';
import type { Queryable } from '../../db/pool';
import { AppError, badRequest, forbidden, isPgError, notFound, PG_ERRORS } from '../../utils/errors';
import { broadcastPollClosed, sendNotification } from '../../socket/realtime';
import { insertClosureNotifications, toNotification } from '../notifications/notifications.repository';
import { findActiveUsersByIdentifiers } from '../users/users.repository';
import type { PublicUser } from '../users/users.types';
import * as repo from './polls.repository';
import { isValidEndTime, type CreatePollInput, type ListPollsQuery, type UpdatePollInput } from './polls.schemas';
import type { Poll, PollResults, PollRow } from './polls.types';

const isAdmin = (u: PublicUser) => u.role === 'admin';
const isOwner = (u: PublicUser, poll: { created_by: string } | Poll) =>
  ('created_by' in poll ? poll.created_by : poll.creator.id) === u.id;

/** Unique index on (poll_id, lower(option_text)) → readable message. */
function mapOptionViolation(err: unknown): never {
  if (isPgError(err, PG_ERRORS.UNIQUE_VIOLATION) && err.constraint === 'poll_options_text_unique_idx') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Les propositions doivent être différentes');
  }
  throw err;
}

/** Loads a poll and, for its creator or an admin, the invited voters list of a private poll. */
async function loadPoll(pollId: string, viewer: PublicUser, db?: Queryable): Promise<Poll | null> {
  const poll = await repo.findPollById(pollId, viewer.id, db);
  if (poll && poll.access === 'PRIVATE' && (isOwner(viewer, poll) || isAdmin(viewer))) {
    poll.voters = await repo.listVoters(pollId, db);
  }
  return poll;
}

/**
 * Loads a poll the user is allowed to see. Drafts are visible to their owner
 * only, and private polls to their owner and invited voters only (admins see
 * everything). Otherwise the poll is reported as "not found" so that its
 * existence is not even revealed.
 */
export async function getPollForViewer(viewer: PublicUser, pollId: string): Promise<Poll> {
  const poll = await loadPoll(pollId, viewer);
  if (!poll) throw notFound('Sondage introuvable');
  const privileged = isOwner(viewer, poll) || isAdmin(viewer);
  if (poll.status === 'DRAFT' && !privileged) throw notFound('Sondage introuvable');
  if (poll.access === 'PRIVATE' && !privileged && !(await repo.isInvitedVoter(pollId, viewer.id))) {
    throw notFound('Sondage introuvable');
  }
  return poll;
}

/**
 * Turns usernames/emails into user ids. Unknown identifiers and the creator
 * themselves are rejected with a message naming the faulty entries.
 */
async function resolveVoters(tx: PoolClient, owner: PublicUser, identifiers: string[]): Promise<string[]> {
  if (identifiers.length === 0) return [];
  const matches = await findActiveUsersByIdentifiers(identifiers, tx);
  const unknown = matches.filter((m) => !m.id).map((m) => m.identifier);
  if (unknown.length) {
    throw badRequest(`Utilisateur introuvable : ${unknown.join(', ')}`, [
      { field: 'voters', message: `Utilisateur introuvable : ${unknown.join(', ')}` },
    ]);
  }
  if (matches.some((m) => m.id === owner.id)) {
    const message = 'Vous ne pouvez pas vous inviter à votre propre sondage : le créateur ne vote pas';
    throw badRequest(message, [{ field: 'voters', message }]);
  }
  return [...new Set(matches.map((m) => m.id!))];
}

export async function createPoll(user: PublicUser, input: CreatePollInput): Promise<Poll> {
  // Poll and options are written atomically: no poll can exist without its options.
  const id = await withTransaction(async (tx) => {
    const pollId = await repo.insertPoll(tx, {
      question: input.question,
      description: input.description,
      createdBy: user.id,
      creationMode: input.creationMode,
      resultsVisibility: input.resultsVisibility,
      access: input.access,
      endTime: input.endTime,
    });
    await repo.insertOptions(tx, pollId, input.options);
    if (input.access === 'PRIVATE') await repo.replaceVoters(tx, pollId, await resolveVoters(tx, user, input.voters));
    return pollId;
  }).catch(mapOptionViolation);
  return (await loadPoll(id, user))!;
}

/** Locks the poll and checks ownership; shared by update/publish/delete. */
async function lockOwnedPoll(tx: PoolClient, user: PublicUser, pollId: string, allowAdmin: boolean) {
  const poll = await repo.lockPoll(tx, pollId, 'UPDATE');
  if (!poll || (poll.status === 'DRAFT' && !isOwner(user, poll) && !isAdmin(user))) throw notFound('Sondage introuvable');
  if (!isOwner(user, poll) && !(allowAdmin && isAdmin(user))) throw forbidden("Vous n'êtes pas le créateur de ce sondage");
  return poll;
}

/** Only DRAFT polls can be edited: once people vote, the question must not change under them. */
export async function updatePoll(user: PublicUser, pollId: string, input: UpdatePollInput): Promise<Poll> {
  await withTransaction(async (tx) => {
    const poll = await lockOwnedPoll(tx, user, pollId, false);
    if (poll.status !== 'DRAFT') {
      throw new AppError(409, 'POLL_NOT_EDITABLE', 'Seul un sondage en brouillon peut être modifié');
    }
    await repo.updatePollFields(tx, pollId, input);
    if (input.options) await repo.replaceOptions(tx, pollId, input.options);
    // A public poll has no invited voters list; a private one keeps it unless a new one is sent.
    const access = input.access ?? poll.access;
    if (access === 'PUBLIC') await repo.replaceVoters(tx, pollId, []);
    else if (input.voters) await repo.replaceVoters(tx, pollId, await resolveVoters(tx, user, input.voters));
  }).catch(mapOptionViolation);
  return (await loadPoll(pollId, user))!;
}

/** DRAFT → ACTIVE */
export async function publishPoll(user: PublicUser, pollId: string): Promise<Poll> {
  await withTransaction(async (tx) => {
    const poll = await lockOwnedPoll(tx, user, pollId, false);
    if (poll.status !== 'DRAFT') throw new AppError(409, 'POLL_ALREADY_PUBLISHED', 'Ce sondage est déjà publié');
    // A draft may have been saved long ago: its end time must still be valid now.
    if (!isValidEndTime(poll.end_time)) {
      throw new AppError(400, 'INVALID_END_TIME', 'La date de clôture doit être au moins 1 minute dans le futur. Modifiez-la avant de publier.');
    }
    if ((await repo.countOptions(tx, pollId)) < 2) {
      throw new AppError(400, 'NOT_ENOUGH_OPTIONS', 'Un sondage doit contenir au moins 2 propositions');
    }
    if (poll.access === 'PRIVATE' && (await repo.countVoters(tx, pollId)) === 0) {
      throw new AppError(400, 'NO_VOTERS', 'Un sondage privé doit avoir au moins un votant invité');
    }
    await repo.setPollActive(tx, pollId);
  });
  return (await loadPoll(pollId, user))!;
}

/** ACTIVE → CLOSED before the end time (owner or admin). */
export async function closePollManually(user: PublicUser, pollId: string): Promise<Poll> {
  const closed = await withTransaction(async (tx) => {
    const poll = await lockOwnedPoll(tx, user, pollId, true);
    if (poll.status !== 'ACTIVE') throw new AppError(409, 'POLL_NOT_ACTIVE', "Seul un sondage actif peut être clôturé");
    return closePollsInTransaction(tx, `WHERE id = $1 AND status = 'ACTIVE'`, [pollId]);
  });
  await afterPollsClosed(closed);
  return (await loadPoll(pollId, user))!;
}

/**
 * Used by the background scheduler: closes every ACTIVE poll whose end time
 * has passed. The UPDATE ... RETURNING is atomic, so even with several server
 * instances each poll is closed (and notified) exactly once.
 */
export async function closeExpiredPolls(): Promise<string[]> {
  const closed = await withTransaction((tx) =>
    closePollsInTransaction(tx, `WHERE status = 'ACTIVE' AND end_time <= now()`, []),
  );
  await afterPollsClosed(closed);
  return closed.polls.map((p) => p.id);
}

/** Status change + notification rows are committed together (all or nothing). */
async function closePollsInTransaction(tx: PoolClient, where: string, params: unknown[]) {
  const { rows: polls } = await tx.query<PollRow>(
    `UPDATE polls SET status = 'CLOSED', closed_at = now() ${where} RETURNING *`,
    params,
  );
  const notifications = polls.length ? await insertClosureNotifications(tx, polls.map((p) => p.id)) : [];
  return { polls, notifications };
}

/** Real-time side effects, executed only after COMMIT. A socket failure never undoes the closure. */
async function afterPollsClosed({ polls, notifications }: Awaited<ReturnType<typeof closePollsInTransaction>>) {
  for (const poll of polls) {
    try {
      const stats = await repo.computeResults(poll.id);
      broadcastPollClosed({
        pollId: poll.id,
        question: poll.question,
        closedAt: poll.closed_at!.toISOString(),
        results: { pollId: poll.id, status: 'CLOSED', visible: true, ...stats, computedAt: new Date().toISOString() },
      });
      logger.info({ pollId: poll.id, totalVotes: stats.totalVotes }, 'Poll closed');
    } catch (err) {
      logger.error({ err, pollId: poll.id }, 'Failed to broadcast poll closure');
    }
  }
  for (const n of notifications) sendNotification(n.user_id, toNotification(n));
}

/** Drafts: owner only. Published polls: admin only (keeps votes and results trustworthy). */
export async function deletePoll(user: PublicUser, pollId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const poll = await lockOwnedPoll(tx, user, pollId, true);
    if (poll.status !== 'DRAFT' && !isAdmin(user)) {
      throw new AppError(409, 'POLL_NOT_DELETABLE', 'Un sondage publié ne peut être supprimé que par un administrateur');
    }
    await repo.deletePoll(tx, pollId);
  });
}

export async function listPolls(user: PublicUser, q: ListPollsQuery) {
  const { polls, total } = await repo.listPublicPolls(user.id, {
    status: q.status,
    search: q.search,
    limit: q.limit,
    offset: (q.page - 1) * q.limit,
  });
  return { polls, pagination: { page: q.page, limit: q.limit, total } };
}

/**
 * Visibility rules for per-option results:
 *  - CLOSED poll: always visible (final results);
 *  - ACTIVE poll in LIVE mode: visible to everyone;
 *  - ACTIVE poll in AFTER_CLOSE mode: only the creator and admins;
 *  - The total number of votes is always public.
 */
export function canSeeDetailedResults(viewer: PublicUser | null, poll: Pick<Poll, 'status' | 'resultsVisibility'> & { creatorId: string }) {
  if (poll.status === 'CLOSED') return true;
  if (poll.resultsVisibility === 'LIVE') return true;
  return viewer !== null && (viewer.id === poll.creatorId || viewer.role === 'admin');
}

export async function buildResults(
  poll: Pick<Poll, 'id' | 'status' | 'resultsVisibility'> & { creatorId: string },
  viewer: PublicUser | null,
): Promise<PollResults> {
  const stats = await repo.computeResults(poll.id);
  const visible = canSeeDetailedResults(viewer, poll);
  return {
    pollId: poll.id,
    status: poll.status,
    totalVotes: stats.totalVotes,
    visible,
    options: visible ? stats.options : [],
    computedAt: new Date().toISOString(),
  };
}

export async function getResults(viewer: PublicUser, pollId: string): Promise<PollResults> {
  const poll = await getPollForViewer(viewer, pollId);
  return buildResults({ ...poll, creatorId: poll.creator.id }, viewer);
}
