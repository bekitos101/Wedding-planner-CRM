import type { Request, RequestHandler } from 'express';
import { unauthenticated } from '../lib/errors.js';
import { authService } from '../services/authService.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (m) return m[1]!;
  }
  const cookie = (req.cookies as Record<string, unknown> | undefined)?.token;
  return typeof cookie === 'string' && cookie ? cookie : null;
}

/** The authenticated user's id; throws 401 if requireAuth did not run. */
export function currentUserId(req: Request): string {
  if (!req.user) throw unauthenticated();
  return req.user.id;
}

/** Authenticates via cookie `token` or `Authorization: Bearer`; sets req.user = { id }. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) throw unauthenticated();
    req.user = await authService.authenticate(token);
    next();
  } catch (err) {
    next(err);
  }
};
