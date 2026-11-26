import type { Request, RequestHandler } from 'express';
import { createRateLimiter } from '../lib/rateLimit.js';

export const AUTH_LIMIT_MESSAGE = 'Too many attempts. Please try again later.';
const MIN = 60_000;

/** Defaults (NFR-01/02 hardening). Counters are per app instance, in memory, and success does not reset them. */
export const DEFAULT_AUTH_LIMITS = {
  loginPerIpAndEmail: { max: 10, windowMs: 15 * MIN },
  loginPerIp: { max: 50, windowMs: 15 * MIN },
  registerPerIp: { max: 10, windowMs: 60 * MIN },
  passwordChangePerUser: { max: 10, windowMs: 15 * MIN },
};
export type AuthLimits = typeof DEFAULT_AUTH_LIMITS;
export type AuthLimitOverrides = { [K in keyof AuthLimits]?: Partial<AuthLimits[K]> };

export interface AuthLimiters {
  loginPerIpAndEmail: RequestHandler;
  loginPerIp: RequestHandler;
  registerPerIp: RequestHandler;
  /** After requireAuth; only counts requests that try to change the password. */
  passwordChange: RequestHandler;
}

const ip = (req: Request) => req.ip ?? 'unknown';

/** IP + lowercased email, or null (not counted here; the per-IP limiter still counts it). */
function ipAndEmailKey(req: Request): string | null {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== 'string') return null;
  return `${ip(req)}|${email.trim().toLowerCase().slice(0, 254)}`;
}

function passwordChangeKey(req: Request): string | null {
  const body = req.body as { password?: unknown } | undefined;
  if (body?.password === undefined) return null;
  return req.user?.id ?? ip(req);
}

/** One set of limiters per app instance so tests stay isolated. */
export function createAuthLimiters(overrides: AuthLimitOverrides = {}, now?: () => number): AuthLimiters {
  const cfg = (k: keyof AuthLimits) => ({ ...DEFAULT_AUTH_LIMITS[k], ...overrides[k], message: AUTH_LIMIT_MESSAGE, now });
  return {
    loginPerIpAndEmail: createRateLimiter({ ...cfg('loginPerIpAndEmail'), key: ipAndEmailKey }),
    loginPerIp: createRateLimiter(cfg('loginPerIp')),
    registerPerIp: createRateLimiter(cfg('registerPerIp')),
    passwordChange: createRateLimiter({ ...cfg('passwordChangePerUser'), key: passwordChangeKey }),
  };
}
