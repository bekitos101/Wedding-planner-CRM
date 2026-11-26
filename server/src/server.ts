import { env } from './config/env.js';
import { createApp } from './app.js';
import { startJobs, stopJobs, waitForJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';
import { reminderService } from './services/reminderService.js';

const app = createApp();
const server = app.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));

if (env.CRON_ENABLED) {
  // Backfill: tasks created before phase 5 (or while jobs were off) get their reminders. Idempotent.
  reminderService
    .syncAllReminders()
    .then((n) => logger.info({ tasks: n }, 'Reminder backfill finished'))
    .catch((err: unknown) => logger.error({ error: err instanceof Error ? err.message : 'unknown error' }, 'Reminder backfill failed'));
  startJobs();
} else {
  logger.info('CRON_ENABLED=false: scheduled jobs are not running');
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopJobs(); // no new runs
  server.close();
  // Let a running job finish its in-flight emails and record them (up to 10 s).
  if (!(await waitForJobs(10_000))) logger.warn('A job was still running at shutdown; exiting anyway');
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
