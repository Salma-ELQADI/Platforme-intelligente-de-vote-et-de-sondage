import { env } from '../config/env';
import { logger } from '../config/logger';
import { activateScheduledPolls, closeExpiredPolls, sendDueReminders } from '../modules/polls/polls.service';

/**
 * Background job, every POLL_CLOSER_INTERVAL_MS:
 *  1. opens scheduled polls whose start time has come;
 *  2. closes expired polls;
 *  3. sends the reminders that are due.
 * Each step is an atomic UPDATE … RETURNING, so it is safe to run on
 * several instances and idempotent across runs.
 *
 * This job is about *state and notifications*. It is NOT what prevents late
 * votes: every vote independently compares end_time with now() in the
 * database, so a vote arriving between the end time and the next tick is
 * still rejected.
 */
export function startPollCloser(intervalMs = env.POLL_CLOSER_INTERVAL_MS) {
  let running = false;

  const tick = async () => {
    if (running) return; // never overlap two runs if one is slow
    running = true;
    try {
      const opened = await activateScheduledPolls();
      if (opened.length) logger.info({ count: opened.length }, 'Scheduled polls opened');
      const closed = await closeExpiredPolls();
      if (closed.length) logger.info({ count: closed.length }, 'Expired polls closed');
      const reminded = await sendDueReminders();
      if (reminded.length) logger.info({ count: reminded.length }, 'Poll reminders sent');
    } catch (err) {
      logger.error({ err }, 'Poll closer run failed');
    } finally {
      running = false;
    }
  };

  void tick(); // catch up immediately on startup (polls that expired while the server was down)
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
