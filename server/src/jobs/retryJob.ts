import type { Logger } from 'pino';
import { logger as defaultLogger } from '../lib/logger.js';
import { invitationService } from '../services/invitationService.js';
import { reminderService, type DeliveryCounts } from '../services/reminderService.js';

const BATCH_SIZE = 50;
const MAX_BATCHES = 200;

export interface RetryCounts {
  reminders: DeliveryCounts;
  invitations: { sent: number; failed: number; skipped: number };
}

/**
 * Retry job (every 10 minutes, FR-64, BR-11, NFR-15/17): retries FAILED reminder emails and FAILED
 * invitation emails that are still below the attempt limit (3). Each item is tried once per run.
 * A mail problem on one item never stops the others. Logs counts only (NFR-06).
 */
export async function runRetryJob(now: Date = new Date(), log: Logger = defaultLogger): Promise<RetryCounts> {
  const reminders = await reminderService.retryFailedEmails(now, log);

  const invitations = { sent: 0, failed: 0, skipped: 0 };
  const tried: string[] = [];
  for (let i = 0; i < MAX_BATCHES; i++) {
    const batch = await invitationService.listRetryCandidates(now, tried, BATCH_SIZE);
    if (batch.length === 0) break;
    for (const candidate of batch) {
      tried.push(candidate.id);
      try {
        invitations[await invitationService.retryDelivery(candidate, now, log)]++;
      } catch (err) {
        // Data problem (e.g. the guest was deleted meanwhile): skip this one, keep the batch going.
        invitations.skipped++;
        log.warn({ job: 'retry', invitationId: candidate.id, error: err instanceof Error ? err.name : 'error' }, 'Invitation retry skipped');
      }
    }
  }

  const result = { reminders, invitations };
  const handled = reminders.sent + reminders.failed + reminders.cancelled + invitations.sent + invitations.failed + invitations.skipped;
  (handled > 0 ? log.info : log.debug).call(log, { job: 'retry', reminders, invitations }, 'Retry job finished');
  return result;
}
