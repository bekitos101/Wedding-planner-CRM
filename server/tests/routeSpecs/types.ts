/** Context passed to every RouteSpec.path(): ids that exist in the authorization test's fixture. */
export interface Ctx {
  weddingId: string;
  userId: string; // a user id usable in :userId segments
}

/**
 * One /weddings/:weddingId/... route. tests/authorization.test.ts runs every spec through the
 * 401 / 404 (non-member, revoked, random id, malformed id) / 403 (team member on owner routes) /
 * 409 (archived) loops, and its enumeration test fails if a mounted route has no spec.
 * Child ids (guestId, taskId, ...) may be random UUIDs: the access checks run before any lookup.
 */
export interface RouteSpec {
  name: string;
  method: 'get' | 'post' | 'patch' | 'delete';
  /** Express pattern, used by the route-enumeration test, e.g. '/weddings/:weddingId/guests/:guestId'. */
  pattern: string;
  path: (c: Ctx) => string;
  body?: object;
  /** 'member' = owner and team members may call it; 'owner' = owner only (members get 403). */
  access: 'member' | 'owner';
  /** Mutates data: answers 409 on an archived wedding unless `archivedStatus` says otherwise. */
  write: boolean;
  /** Expected status for the owner on an ARCHIVED wedding when it is not the default (409 write / 200 read). */
  archivedStatus?: number;
  /**
   * Expected status when an active team member calls this READ route on an active wedding
   * (default 200). Single-record reads tested with a random child id answer 404 here — set 404.
   */
  memberReadStatus?: number;
}
