import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';
import { setMailTransportForTests } from '../../src/lib/mailer.js';
import { prisma } from '../../src/lib/prisma.js';
import { api } from './app.js';
import { bearer } from './auth.js';
import { dateStr } from './taskFactories.js';

export interface SentMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Stub SMTP transport. `failFor(to)` decides which recipients fail (throws like a real SMTP error). */
export function installMail(failFor: (to: string) => boolean = () => false) {
  const state = { sent: [] as SentMail[], failFor, attempts: 0 };
  setMailTransportForTests({
    async sendMail(m) {
      state.attempts++;
      if (state.failFor(m.to)) throw new Error('connect ECONNREFUSED 127.0.0.1:1025');
      state.sent.push({ to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) });
      return { messageId: 'test' };
    },
  });
  return state;
}

export const uninstallMail = () => setMailTransportForTests(undefined);

/** A logger that captures everything it writes (debug level) so tests can scan it. */
export function captureLogger(): { log: Logger; output: () => string } {
  let out = '';
  const stream = new Writable({
    write(chunk, _e, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return { log: pino({ level: 'debug' }, stream), output: () => out };
}

/** The 07:00 UTC reminder moment for a task due `dueInDays` from today, `daysBefore` days earlier. */
export const reminderMoment = (dueInDays: number, daysBefore = 3): Date => new Date(`${dateStr(dueInDays - daysBefore)}T07:00:00.000Z`);

export const rowsFor = (taskId: string) =>
  prisma.notification.findMany({ where: { taskId }, orderBy: [{ channel: 'asc' }, { scheduledAt: 'asc' }] });

/** Creates a task through the API as `ownerId`. */
export async function apiTask(
  weddingId: string,
  ownerId: string,
  body: { title?: string; dueInDays: number; assigneeId?: string | null; status?: string },
) {
  const { dueInDays, ...rest } = body;
  const res = await api()
    .post(`/api/weddings/${weddingId}/tasks`)
    .set(bearer(ownerId))
    .send({ title: 'Book the venue', priority: 'HIGH', ...rest, dueDate: dateStr(dueInDays) });
  if (res.status !== 201) throw new Error(`task create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string };
}

export const patchTask = (weddingId: string, taskId: string, userId: string, body: Record<string, unknown>) =>
  api().patch(`/api/weddings/${weddingId}/tasks/${taskId}`).set(bearer(userId)).send(body);
