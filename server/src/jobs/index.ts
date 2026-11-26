import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../lib/logger.js';
import { runReminderJob } from './reminderJob.js';
import { runRetryJob } from './retryJob.js';

// node-cron inside the single API process (no queues). Started by server.ts only when CRON_ENABLED;
// createApp() never starts jobs, so tests call runReminderJob / runRetryJob directly.

const tasks: ScheduledTask[] = [];
const inFlight = new Set<Promise<void>>();

/** Skips a tick while the previous run of the same job is still going; a failed run is logged, never thrown. */
export function guarded(name: string, run: () => Promise<unknown>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      logger.warn({ job: name }, 'Previous run still in progress; skipping this tick');
      return;
    }
    running = true;
    const current = (async () => {
      try {
        await run();
      } catch (err) {
        logger.error({ job: name, error: err instanceof Error ? err.message : 'unknown error' }, 'Job run failed');
      } finally {
        running = false;
      }
    })();
    inFlight.add(current);
    try {
      await current;
    } finally {
      inFlight.delete(current);
    }
  };
}

export function startJobs(): void {
  if (tasks.length > 0) return;
  tasks.push(cron.schedule('* * * * *', guarded('reminders', () => runReminderJob())));
  tasks.push(cron.schedule('*/10 * * * *', guarded('retry', () => runRetryJob())));
  logger.info('Scheduled jobs started: reminders (every minute), retry (every 10 minutes)');
}

/** Stops scheduling new runs; a run that is already going keeps going (see waitForJobs). */
export function stopJobs(): void {
  for (const t of tasks.splice(0)) void t.stop();
}

/** Resolves when no job run is in flight, or after `timeoutMs`. Returns true when everything finished. */
export async function waitForJobs(timeoutMs: number): Promise<boolean> {
  if (inFlight.size === 0) return true;
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs).unref());
  return Promise.race([Promise.allSettled([...inFlight]).then(() => true), timeout]);
}
