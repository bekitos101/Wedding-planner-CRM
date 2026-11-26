import type { Logger } from 'pino';
import { logger as defaultLogger } from '../lib/logger.js';
import { reminderService, type DeliveryCounts } from '../services/reminderService.js';

/**
 * Reminder job (every minute, FR-61, NFR-15/16/17): delivers due PENDING reminders. A plain function
 * so tests call it with a fixed `now`. Logs counts and ids only; a failed send logs the subject (a task
 * title) and the error, never addresses, links or bodies (NFR-06).
 */
export async function runReminderJob(now: Date = new Date(), log: Logger = defaultLogger): Promise<DeliveryCounts> {
  const counts = await reminderService.deliverDue(now, log);
  const handled = counts.sent + counts.failed + counts.cancelled;
  (handled > 0 ? log.info : log.debug).call(log, { job: 'reminders', ...counts }, 'Reminder job finished');
  return counts;
}
