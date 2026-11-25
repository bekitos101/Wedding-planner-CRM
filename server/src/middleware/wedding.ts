import type { Request, RequestHandler } from 'express';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { parseUuidParam } from '../lib/ids.js';
import { ARCHIVED_MESSAGE, weddingService, type WeddingAccess } from '../services/weddingService.js';
import { currentUserId } from './auth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      wedding?: WeddingAccess['wedding'];
      weddingRole?: WeddingAccess['role'];
    }
  }
}

const weddingNotFound = () => notFound('Wedding not found.');

/**
 * Must run after requireAuth. Reads `:weddingId`; the caller must be the owner or an ACTIVE
 * member, otherwise 404 "Wedding not found." (identical for missing, malformed, foreign and
 * revoked, BR-14). Sets req.wedding and req.weddingRole.
 */
export const loadWedding: RequestHandler = async (req, _res, next) => {
  try {
    const userId = currentUserId(req);
    const id = parseUuidParam(req.params.weddingId);
    if (!id) throw weddingNotFound();
    const access = await weddingService.resolveAccess(id, userId);
    if (!access) throw weddingNotFound();
    req.wedding = access.wedding;
    req.weddingRole = access.role;
    next();
  } catch (err) {
    next(err);
  }
};

/** After loadWedding: only the owner (403 for team members). */
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (!req.weddingRole) return next(weddingNotFound());
  if (req.weddingRole !== 'OWNER') return next(forbidden('Only the wedding owner can do this.'));
  next();
};

/** After loadWedding: owner or active team member (read access). */
export const requireMember: RequestHandler = (req, _res, next) => {
  if (req.weddingRole !== 'OWNER' && req.weddingRole !== 'TEAM_MEMBER') return next(weddingNotFound());
  next();
};

/** After loadWedding: archived weddings are read-only (BR-13). Put on every write route. */
export const requireActiveWedding: RequestHandler = (req, _res, next) => {
  if (!req.wedding) return next(weddingNotFound());
  if (req.wedding.status === 'ARCHIVED') return next(conflict(ARCHIVED_MESSAGE));
  next();
};

// requireAuth + loadWedding + requireMember run once in routes/weddingScoped.ts for every
// /weddings/:weddingId/... route. Individual routes only add the chains below.
/** Owner-only route that is allowed on archived weddings (reads, revoking access): 403 for members. */
export const ownerAccess: readonly RequestHandler[] = Object.freeze([requireOwner]);
/** Owner write on an ACTIVE wedding: 403 for members, then 409 when archived. */
export const ownerWriteAccess: readonly RequestHandler[] = Object.freeze([requireOwner, requireActiveWedding]);

/** The current wedding id; throws 404 if loadWedding did not run. */
export function currentWeddingId(req: Request): string {
  if (!req.wedding) throw weddingNotFound();
  return req.wedding.id;
}
