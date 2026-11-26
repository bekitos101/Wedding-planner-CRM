import type { NotificationChannel } from '@prisma/client';
import type { Logger } from 'pino';
import { env } from '../config/env.js';
import { logger as defaultLogger } from '../lib/logger.js';
import { daysBetween, formatHumanDate, todayUtc } from '../lib/dates.js';
import { escapeHtml, oneLine } from '../lib/html.js';
import { sendMail } from '../lib/mailer.js';
import { MAX_EMAIL_ATTEMPTS } from '../lib/mailPolicy.js';
import {
  notificationRepository,
  type DeliveryRow,
  type ReminderRow,
  type ReminderTask,
  type ReminderTx,
} from '../repositories/notificationRepository.js';
import { friendlyMailError } from './invitationService.js';

// Task deadline reminders (FR-61..63, BR-09/10/13, NFR-15/16/17). All rules live here: who gets a
// reminder, when it is due, when a task is eligible, and what a delivery does to a row.

export const REMINDER_HOUR_UTC = 7;
const CHANNELS: readonly NotificationChannel[] = ['IN_APP', 'EMAIL'];
const BATCH_SIZE = 50;
const MAX_BATCHES = 200; // safety net against a runaway loop; 200 x 50 reminders per run

export interface DeliveryCounts {
  sent: number;
  failed: number;
  cancelled: number;
}

/** Recipient = the assignee, or the wedding owner while the task is unassigned. */
export const recipientOf = (t: ReminderTask): string => t.assigneeId ?? t.wedding.ownerId;

/** FR-61/63, BR-09/13: not completed, wedding active, and not past its deadline (no overdue reminders). */
export function isEligible(t: ReminderTask, now: Date): boolean {
  return t.status !== 'COMPLETED' && t.wedding.status === 'ACTIVE' && t.dueDate.getTime() >= todayUtc(now).getTime();
}

/** dueDate - REMINDER_DAYS_BEFORE days at 07:00 UTC. */
export function reminderBase(dueDate: Date, daysBefore: number = env.REMINDER_DAYS_BEFORE): Date {
  return new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate() - daysBefore, REMINDER_HOUR_UTC));
}

const keyOf = (userId: string, channel: NotificationChannel, at: Date): string => `${userId}|${channel}|${at.getTime()}`;

/**
 * When the reminder for this (recipient, channel) should fire. Normally `base`. If `base` has
 * already passed (the task is due soon or was created/rescheduled late) it is `now` — but a
 * late reminder that already exists for this deadline (any status, scheduled between `base` and
 * `now`) is reused, so re-syncing never creates a second one or re-sends a delivered one.
 */
function scheduledFor(base: Date, now: Date, existing: ReminderRow[]): Date {
  if (base.getTime() >= now.getTime()) return base;
  const reusable = existing
    .filter((r) => r.scheduledAt.getTime() >= base.getTime() && r.scheduledAt.getTime() <= now.getTime())
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0];
  return reusable ? reusable.scheduledAt : now;
}

function buildReminderEmail(row: DeliveryRow, now: Date) {
  const t = row.task;
  const due = formatHumanDate(t.dueDate);
  const days = daysBetween(todayUtc(now), t.dueDate);
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  const link = `${env.APP_BASE_URL.replace(/\/+$/, '')}/weddings/${t.wedding.id}/tasks`;
  const title = oneLine(t.title);
  const couple = oneLine(t.wedding.coupleNames);
  const name = oneLine(row.user.name);
  const text = [
    `Hello ${name},`,
    '',
    `Your task "${title}" is due on ${due} (${when}).`,
    `Wedding: ${couple}`,
    '',
    `Open the task list: ${link}`,
  ].join('\n');
  const html = [
    `<p>Hello ${escapeHtml(name)},</p>`,
    `<p>Your task <strong>${escapeHtml(title)}</strong> is due on ${escapeHtml(due)} (${when}).<br>Wedding: ${escapeHtml(couple)}</p>`,
    `<p><a href="${escapeHtml(link)}">Open the task list</a></p>`,
  ].join('\n');
  // Subject: no links, no tokens (it is logged on failure, NFR-06).
  return { subject: `Reminder: "${title}" is due on ${due}`, text, html };
}

/**
 * One claimed row: cancel it if it is stale, otherwise deliver it (OUTSIDE any transaction) and
 * record the outcome with a compare-and-set. Returns null when the CAS found the row changed (it
 * was cancelled or re-claimed while the email was in flight: at most that one email goes out).
 */
async function deliverRow(row: DeliveryRow, now: Date, log: Logger): Promise<keyof DeliveryCounts | null> {
  const task: ReminderTask = {
    id: row.task.id,
    title: row.task.title,
    status: row.task.status,
    dueDate: row.task.dueDate,
    assigneeId: row.task.assigneeId,
    weddingId: row.task.wedding.id,
    wedding: { ownerId: row.task.wedding.ownerId, status: row.task.wedding.status },
  };
  // Re-check at delivery time (BR-09/10/13, FR-63): the task may have changed since it was scheduled.
  // A row scheduled before the current deadline's reminder moment belongs to an old date (BR-10).
  const stale =
    !isEligible(task, now) || recipientOf(task) !== row.userId || row.scheduledAt.getTime() < reminderBase(task.dueDate).getTime();
  if (stale) {
    return (await notificationRepository.recordClaimed(row, { status: 'CANCELLED' })) ? 'cancelled' : null;
  }

  if (row.channel === 'IN_APP') {
    return (await notificationRepository.recordClaimed(row, { status: 'SENT', sentAt: now, lastError: null })) ? 'sent' : null;
  }

  // sendMail never throws (NFR-17); a failure is recorded on this row and the batch continues.
  const mail = buildReminderEmail(row, now);
  const result = await sendMail({ to: row.user.email, ...mail }, log);
  const attemptCount = row.attemptCount + 1;
  if (result.ok) {
    return (await notificationRepository.recordClaimed(row, { status: 'SENT', sentAt: now, attemptCount, lastError: null })) ? 'sent' : null;
  }
  const recorded = await notificationRepository.recordClaimed(row, {
    status: 'FAILED',
    attemptCount,
    lastError: friendlyMailError(result.error),
  });
  return recorded ? 'failed' : null;
}

async function processBatch(rows: DeliveryRow[], counts: DeliveryCounts, now: Date, log: Logger, done?: string[]): Promise<number> {
  let lost = 0;
  for (const row of rows) {
    done?.push(row.id);
    const outcome = await deliverRow(row, now, log);
    if (outcome) counts[outcome]++;
    else lost++;
  }
  if (lost > 0) log.warn({ job: 'reminders', lost }, 'Rows changed while their email was in flight; results not recorded');
  return rows.length;
}

export const reminderService = {
  /**
   * Makes the stored reminders match the task, inside the caller's transaction (FR-61/62, BR-09/10).
   * Eligible task -> exactly one IN_APP and one EMAIL reminder for the recipient. PENDING rows that
   * no longer match are CANCELLED; missing rows are inserted; a CANCELLED row that matches again is
   * revived; SENT / FAILED rows are left alone (never re-send something already delivered).
   */
  async syncTask(tx: ReminderTx, taskId: string, now: Date = new Date()): Promise<void> {
    const task = await tx.findTask(taskId);
    if (!task) return;
    const existing = await tx.listForTask(taskId);

    const wanted: { userId: string; channel: NotificationChannel; scheduledAt: Date }[] = [];
    if (isEligible(task, now)) {
      const userId = recipientOf(task);
      const base = reminderBase(task.dueDate);
      for (const channel of CHANNELS) {
        const mine = existing.filter((r) => r.userId === userId && r.channel === channel);
        wanted.push({ userId, channel, scheduledAt: scheduledFor(base, now, mine) });
      }
    }

    const wantedKeys = new Set(wanted.map((w) => keyOf(w.userId, w.channel, w.scheduledAt)));
    await tx.cancel(existing.filter((r) => (r.status === 'PENDING' || r.status === 'FAILED') && !wantedKeys.has(keyOf(r.userId, r.channel, r.scheduledAt))).map((r) => r.id));

    const byKey = new Map(existing.map((r) => [keyOf(r.userId, r.channel, r.scheduledAt), r]));
    const revive: string[] = [];
    const insert: { taskId: string; userId: string; channel: NotificationChannel; scheduledAt: Date }[] = [];
    for (const w of wanted) {
      const match = byKey.get(keyOf(w.userId, w.channel, w.scheduledAt));
      if (!match) insert.push({ taskId, ...w });
      else if (match.status === 'CANCELLED') revive.push(match.id);
    }
    await tx.revive(revive);
    await tx.insertMissing(insert);
  },

  /** BR-13: archiving cancels every PENDING reminder of the wedding (same transaction as the archive). */
  cancelForWedding(tx: ReminderTx, weddingId: string): Promise<number> {
    return tx.cancelPendingForWedding(weddingId);
  },

  /**
   * Backfill (startup + seed): syncs every task that could hold or need reminders, one transaction
   * per task. Idempotent. Returns the number of tasks looked at.
   */
  async syncAllReminders(now: Date = new Date(), log: Logger = defaultLogger): Promise<number> {
    const ids = await notificationRepository.backfillTaskIds(todayUtc(now));
    let failed = 0;
    for (const id of ids) {
      try {
        await notificationRepository.reminderTransaction((tx) => reminderService.syncTask(tx, id, now));
      } catch (err) {
        failed++; // one broken task must not stop the rest
        log.error({ taskId: id, error: err instanceof Error ? err.name : 'error' }, 'Reminder sync failed for task');
      }
    }
    if (failed > 0) log.warn({ tasks: ids.length, failed }, 'Reminder backfill finished with failures');
    return ids.length - failed;
  },

  /**
   * Reminder job body (FR-61, NFR-15/16): claims due PENDING rows with a lease (short transaction),
   * sends WITHOUT holding any transaction or lock, then records each result with a compare-and-set.
   * Delivery is at least once: reruns and concurrent runs never duplicate, but a crash between send
   * and record (or a lease expiry) can re-send one email.
   */
  async deliverDue(now: Date, log: Logger): Promise<DeliveryCounts> {
    const counts: DeliveryCounts = { sent: 0, failed: 0, cancelled: 0 };
    for (let i = 0; i < MAX_BATCHES; i++) {
      const rows = await notificationRepository.claimDue(now, BATCH_SIZE); // short transaction, lease
      if (rows.length === 0) break;
      await processBatch(rows, counts, now, log);
    }
    return counts;
  },

  /** Retry job, reminder part (FR-64, BR-11): FAILED EMAIL rows below the attempt limit, each tried once per run. */
  async retryFailedEmails(now: Date, log: Logger): Promise<DeliveryCounts> {
    const counts: DeliveryCounts = { sent: 0, failed: 0, cancelled: 0 };
    const done: string[] = [];
    for (let i = 0; i < MAX_BATCHES; i++) {
      const rows = await notificationRepository.claimFailedEmails(MAX_EMAIL_ATTEMPTS, done, BATCH_SIZE);
      if (rows.length === 0) break;
      await processBatch(rows, counts, now, log, done);
    }
    return counts;
  },
};
