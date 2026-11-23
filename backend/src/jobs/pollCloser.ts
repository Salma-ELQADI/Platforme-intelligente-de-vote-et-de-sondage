import { env } from '../config/env';
import { logger } from '../config/logger';
import { closeExpiredPolls } from '../modules/polls/polls.service';

/**
 * Background job that closes expired polls every POLL_CLOSER_INTERVAL_MS.
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
      const closed = await closeExpiredPolls();
      if (closed.length) logger.info({ count: closed.length }, 'Expired polls closed');
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
