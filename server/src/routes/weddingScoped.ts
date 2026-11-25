import { Router } from 'express';
import { loadWedding, requireMember } from '../middleware/wedding.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * Everything under /weddings/:weddingId. The guard runs ONCE here, structurally, so no per-wedding
 * route can forget it: requireAuth (401) -> loadWedding (404 for non-members, BR-14) -> requireMember.
 *
 * Phase 3 pattern (routes/index.ts mounts sub-routers on this router):
 *   // routes/guests.ts
 *   export const guestsRouter = Router({ mergeParams: true });
 *   guestsRouter.get('/', handler);                                   // read: owner + members
 *   guestsRouter.post('/', ...ownerWriteAccess, handler);             // owner write on an ACTIVE wedding
 *   guestsRouter.delete('/:guestId', ...ownerWriteAccess, handler);
 *   // routes/index.ts:  weddingScoped.use('/guests', guestsRouter);
 * Use `currentWeddingId(req)` and query child rows by BOTH their id and weddingId.
 */
export const weddingScoped = Router({ mergeParams: true });
weddingScoped.use(requireAuth, loadWedding, requireMember);
