import { AppError } from './errors';

/**
 * Sliding-window limiter keyed by user id, shared by the REST route and the
 * Socket.IO handler so both entry points spend the same budget. In memory,
 * like the HTTP limiters (express-rate-limit's default store).
 */
export function createUserRateLimiter(opts: { limit: number; windowMs: number; message: string }) {
  const hits = new Map<string, number[]>();

  return function consume(userId: string) {
    const now = Date.now();
    const recent = (hits.get(userId) ?? []).filter((t) => now - t < opts.windowMs);
    if (recent.length >= opts.limit) {
      hits.set(userId, recent);
      throw new AppError(429, 'RATE_LIMITED', opts.message);
    }
    recent.push(now);
    hits.set(userId, recent);
    // Opportunistic cleanup so idle users do not accumulate forever.
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < opts.windowMs)) hits.delete(k);
  };
}
