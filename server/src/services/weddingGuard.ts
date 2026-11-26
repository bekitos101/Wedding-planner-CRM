import { conflict, notFound } from '../lib/errors.js';
import { weddingRepository, type Tx } from '../repositories/weddingRepository.js';
import { ARCHIVED_MESSAGE } from './weddingService.js';

/**
 * BR-13 inside the write transaction: locks the wedding row (FOR SHARE) and throws 409 when it is
 * archived, 404 when it is gone. The route middleware check is only the fast path; this one cannot
 * be overtaken by a concurrent archive. Call it FIRST in the transaction (lock order: Wedding,
 * then child rows; see weddingRepository.lockStatus).
 */
export async function assertWeddingActive(tx: Tx, weddingId: string): Promise<void> {
  const status = await weddingRepository.lockStatus(tx, weddingId);
  if (status === null) throw notFound('Wedding not found.');
  if (status !== 'ACTIVE') throw conflict(ARCHIVED_MESSAGE);
}

/** Runs `work` in a transaction that starts with assertWeddingActive. */
export function inActiveWedding<T>(weddingId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  return weddingRepository.transaction(async (tx) => {
    await assertWeddingActive(tx, weddingId);
    return work(tx);
  });
}
