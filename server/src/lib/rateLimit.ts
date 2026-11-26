import type { Request, RequestHandler } from 'express';
import { tooManyRequests } from './errors.js';

export type RateLimiter = RequestHandler & { size(): number };

const SWEEP_EVERY_MS = 60_000;

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  message: string;
  now?: () => number;
  /** Counting key for a request (default: the client IP). Return null to skip counting this request. */
  key?: (req: Request) => string | null;
}

/** Tiny in-memory fixed-window limiter (default key: client IP). Create one per app instance. */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;
  const keyOf = opts.key ?? ((req: Request) => req.ip ?? 'unknown');
  let lastSweep = now();
  const limiter = ((req, _res, next) => {
    const t = now();
    if (t - lastSweep >= SWEEP_EVERY_MS) {
      lastSweep = t;
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    const key = keyOf(req);
    if (key === null) return next();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) entry = { count: 0, resetAt: t + opts.windowMs };
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > opts.max) return next(tooManyRequests(opts.message));
    next();
  }) as RateLimiter;
  limiter.size = () => hits.size;
  return limiter;
}
