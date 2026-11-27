import type { PoolClient } from 'pg';
import { withTransaction } from '../../db/pool';
import { logger } from '../../config/logger';
import type { Queryable } from '../../db/pool';
import { AppError, badRequest, forbidden, isPgError, notFound, PG_ERRORS } from '../../utils/errors';
import { broadcastPollClosed, sendNotification } from '../../socket/realtime';
import { postPollMessage } from '../messaging/messaging.service';
import {
  insertClosureNotifications,
  insertOpenedNotifications,
  insertReminderNotifications,
  toNotification,
} from '../notifications/notifications.repository';
import { findActiveUsersByIdentifiers } from '../users/users.repository';
import type { PublicUser } from '../users/users.types';
import * as repo from './polls.repository';
import { crossFieldIssues, isValidEndTime, type CreatePollInput, type ListPollsQuery, type UpdatePollInput } from './polls.schemas';
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
  // Drafts and scheduled polls are not public yet: only their owner (and admins) can see them.
  if ((poll.status === 'DRAFT' || poll.status === 'SCHEDULED') && !privileged) throw notFound('Sondage introuvable');
  if (poll.access === 'PRIVATE' && !privileged && !(await repo.isInvitedVoter(pollId, viewer.id))) {
    throw notFound('Sondage introuvable');
  }
  // Group polls follow the group's membership: a removed member loses access at once.
  if (poll.access === 'GROUP' && !privileged && !(await repo.isGroupMember(poll.group!.id, viewer.id))) {
    throw notFound('Sondage introuvable');
  }
  return poll;
}

/** The author of a group poll must belong to the group it is addressed to. */
async function requireGroupMembership(db: Queryable, user: PublicUser, groupId: string | null | undefined) {
  if (!groupId || !(await repo.isGroupMember(groupId, user.id, db))) {
    const message = 'Vous devez faire partie du groupe pour lui adresser un sondage';
    throw new AppError(400, 'NOT_GROUP_MEMBER', message, [{ field: 'groupId', code: 'NOT_GROUP_MEMBER', message }]);
  }
  return groupId;
}

/** Polls of a group conversation, for its members only. */
export async function listGroupPolls(viewer: PublicUser, groupId: string) {
  if (!(await repo.isGroupMember(groupId, viewer.id))) throw notFound('Conversation introuvable');
  return repo.listGroupPolls(viewer.id, groupId);
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
      { field: 'voters', code: 'UNKNOWN_VOTERS', params: { names: unknown.join(', ') }, message: `Utilisateur introuvable : ${unknown.join(', ')}` },
    ]);
  }
  if (matches.some((m) => m.id === owner.id)) {
    const message = 'Vous ne pouvez pas vous inviter à votre propre sondage : le créateur ne vote pas';
    throw badRequest(message, [{ field: 'voters', code: 'SELF_INVITE', message }]);
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
      groupId: input.access === 'GROUP' ? await requireGroupMembership(tx, user, input.groupId) : null,
      votingMethod: input.votingMethod,
      maxChoices: input.votingMethod === 'MULTIPLE' ? (input.maxChoices ?? null) : null,
      startsAt: input.startsAt ?? null,
      remindBeforeMinutes: input.access === 'PUBLIC' ? null : (input.remindBeforeMinutes ?? null),
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
  if (!poll || ((poll.status === 'DRAFT' || poll.status === 'SCHEDULED') && !isOwner(user, poll) && !isAdmin(user))) {
    throw notFound('Sondage introuvable');
  }
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
    const access = input.access ?? poll.access;
    const groupId = access === 'GROUP' ? await requireGroupMembership(tx, user, input.groupId ?? poll.group_id) : null;
    // Cross-field rules are checked on the poll as it will be after the update.
    const votingMethod = input.votingMethod ?? poll.voting_method;
    const merged = {
      options: input.options ?? undefined,
      votingMethod,
      maxChoices: votingMethod === 'MULTIPLE' ? (input.maxChoices !== undefined ? input.maxChoices : poll.max_choices) : null,
      startsAt: input.startsAt !== undefined ? input.startsAt : poll.starts_at,
      endTime: input.endTime ?? poll.end_time,
      access,
      remindBeforeMinutes: access === 'PUBLIC' ? null : input.remindBeforeMinutes !== undefined ? input.remindBeforeMinutes : poll.remind_before_minutes,
    };
    const issues = crossFieldIssues(merged);
    if (issues.length) throw badRequest(issues[0].message, issues.map((i) => ({ field: i.path, code: i.code, message: i.message })));
    await repo.updatePollFields(tx, pollId, {
      ...input,
      groupId,
      maxChoices: merged.maxChoices,
      remindBeforeMinutes: merged.remindBeforeMinutes,
    });
    if (input.options) await repo.replaceOptions(tx, pollId, input.options);
    // Only a private poll has an invited voters list; it is kept unless a new one is sent.
    if (access !== 'PRIVATE') await repo.replaceVoters(tx, pollId, []);
    else if (input.voters) await repo.replaceVoters(tx, pollId, await resolveVoters(tx, user, input.voters));
  }).catch(mapOptionViolation);
  return (await loadPoll(pollId, user))!;
}

/**
 * DRAFT → ACTIVE, or DRAFT → SCHEDULED when the poll has a future start time
 * (the background job opens it at that time, see activateScheduledPolls).
 */
export async function publishPoll(user: PublicUser, pollId: string): Promise<Poll> {
  const opened = await withTransaction(async (tx) => {
    const poll = await lockOwnedPoll(tx, user, pollId, false);
    if (poll.status !== 'DRAFT') throw new AppError(409, 'POLL_ALREADY_PUBLISHED', 'Ce sondage est déjà publié');
    // A draft may have been saved long ago: its end time must still be valid now.
    if (!isValidEndTime(poll.end_time)) {
      throw new AppError(400, 'INVALID_END_TIME', 'La date de clôture doit être au moins 1 minute dans le futur. Modifiez-la avant de publier.');
    }
    const optionCount = await repo.countOptions(tx, pollId);
    if (optionCount < 2) {
      throw new AppError(400, 'NOT_ENOUGH_OPTIONS', 'Un sondage doit contenir au moins 2 propositions');
    }
    if (poll.voting_method === 'MULTIPLE' && (poll.max_choices ?? 0) > optionCount) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Le nombre de choix ne peut pas dépasser le nombre de propositions');
    }
    if (poll.access === 'PRIVATE' && (await repo.countVoters(tx, pollId)) === 0) {
      throw new AppError(400, 'NO_VOTERS', 'Un sondage privé doit avoir au moins un votant invité');
    }
    if (poll.access === 'GROUP') await requireGroupMembership(tx, user, poll.group_id);

    const scheduled = poll.starts_at !== null && poll.starts_at.getTime() > Date.now();
    const opensAt = scheduled ? poll.starts_at!.getTime() : Date.now();
    if (poll.remind_before_minutes && poll.end_time.getTime() - opensAt <= poll.remind_before_minutes * 60_000) {
      throw new AppError(400, 'INVALID_REMINDER', 'Le rappel doit tomber après l’ouverture du scrutin : choisissez un délai plus court');
    }
    if (scheduled) {
      await repo.setPollStatus(tx, pollId, 'SCHEDULED');
      return null;
    }
    await repo.setPollActive(tx, pollId);
    return { poll, notifications: await insertOpenedNotifications(tx, [pollId]) };
  });
  if (opened) await afterPollsOpened([opened.poll], opened.notifications);
  return (await loadPoll(pollId, user))!;
}

/** SCHEDULED → DRAFT: the author takes a scheduled poll back to edit it (nobody could vote yet). */
export async function unschedulePoll(user: PublicUser, pollId: string): Promise<Poll> {
  await withTransaction(async (tx) => {
    const poll = await lockOwnedPoll(tx, user, pollId, false);
    if (poll.status !== 'SCHEDULED') throw new AppError(409, 'POLL_NOT_SCHEDULED', "Ce sondage n'est pas programmé");
    await repo.setPollStatus(tx, pollId, 'DRAFT');
  });
  return (await loadPoll(pollId, user))!;
}

/**
 * After a poll opens (immediately or at its scheduled time), once committed:
 * a group poll is announced in the group's chat, and the invited voters of a
 * private poll get a notification.
 */
async function afterPollsOpened(polls: PollRow[], notifications: Awaited<ReturnType<typeof insertOpenedNotifications>>) {
  for (const poll of polls) {
    if (poll.group_id) {
      await postPollMessage(poll.created_by, poll.group_id, poll.id, poll.question).catch((err) =>
        logger.error({ err, pollId: poll.id }, 'Failed to announce the group poll'),
      );
    }
  }
  for (const n of notifications) sendNotification(n.user_id, toNotification(n));
}

/**
 * Background job: opens every SCHEDULED poll whose start time has come.
 * The UPDATE … RETURNING is atomic, so each poll is opened (and announced) once.
 */
export async function activateScheduledPolls(): Promise<string[]> {
  const { polls, notifications } = await withTransaction(async (tx) => {
    const { rows } = await tx.query<PollRow>(
      `UPDATE polls SET status = 'ACTIVE', published_at = now()
        WHERE status = 'SCHEDULED' AND starts_at <= now()
        RETURNING *`,
    );
    return { polls: rows, notifications: rows.length ? await insertOpenedNotifications(tx, rows.map((p) => p.id)) : [] };
  });
  await afterPollsOpened(polls, notifications);
  return polls.map((p) => p.id);
}

/**
 * Background job: reminds the eligible voters who have not voted yet, once,
 * `remind_before_minutes` before the end. reminder_sent_at is set in the same
 * atomic UPDATE that selects the polls, so a reminder is never sent twice,
 * even with several server instances.
 */
export async function sendDueReminders(): Promise<string[]> {
  const notifications = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE polls SET reminder_sent_at = now()
        WHERE status = 'ACTIVE' AND remind_before_minutes IS NOT NULL AND reminder_sent_at IS NULL
          AND end_time > now() AND end_time - make_interval(mins => remind_before_minutes) <= now()
        RETURNING id`,
    );
    return rows.length ? insertReminderNotifications(tx, rows.map((r) => r.id)) : [];
  });
  for (const n of notifications) sendNotification(n.user_id, toNotification(n));
  return [...new Set(notifications.map((n) => n.poll_id!))];
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
    // Drafts and scheduled polls have no votes yet: their author may delete them.
    if (poll.status !== 'DRAFT' && poll.status !== 'SCHEDULED' && !isAdmin(user)) {
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
    method: stats.method,
    options: visible ? stats.options : [],
    ...(stats.method === 'RANKED' && { rounds: visible ? stats.rounds : [], winners: visible ? stats.winners : [] }),
    computedAt: new Date().toISOString(),
  };
}

export async function getResults(viewer: PublicUser, pollId: string): Promise<PollResults> {
  const poll = await getPollForViewer(viewer, pollId);
  return buildResults({ ...poll, creatorId: poll.creator.id }, viewer);
}
