import { daysBetween, formatHumanDate, todayUtc, toDateOnly } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';
import { notificationRepository, type NotificationApiRow } from '../repositories/notificationRepository.js';

const LIST_LIMIT = 50;

/** Title/message/link are built at read time from the CURRENT task, so a reschedule is reflected. */
export function toNotificationDto(n: NotificationApiRow, today: Date = todayUtc()) {
  const t = n.task;
  const days = daysBetween(today, t.dueDate);
  const done = t.status === 'COMPLETED';
  const title = done
    ? 'Task completed'
    : days < 0
      ? 'Task deadline passed'
      : days === 0
        ? 'Task due today'
        : days === 1
          ? 'Task due tomorrow'
          : `Task due in ${days} days`;
  const verb = done ? 'was due' : days < 0 ? 'was due' : 'is due';
  return {
    id: n.id,
    type: n.type,
    title,
    message: `"${t.title}" ${verb} on ${formatHumanDate(t.dueDate)} — ${t.wedding.coupleNames}.`,
    link: `/weddings/${t.wedding.id}/tasks`,
    createdAt: (n.sentAt ?? n.scheduledAt).toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
    task: { id: t.id, title: t.title, dueDate: toDateOnly(t.dueDate), status: t.status },
    wedding: { id: t.wedding.id, coupleNames: t.wedding.coupleNames },
  };
}
export type NotificationDto = ReturnType<typeof toNotificationDto>;

/**
 * The caller's in-app notifications (FR-61). Only delivered IN_APP rows of weddings the caller can
 * still access are visible, and only their own: everything else behaves as if it did not exist.
 */
export const notificationService = {
  async list(userId: string, unreadOnly: boolean): Promise<NotificationDto[]> {
    const today = todayUtc();
    const rows = await notificationRepository.listVisible(userId, unreadOnly, LIST_LIMIT);
    return rows.map((n) => toNotificationDto(n, today));
  },

  async unreadCount(userId: string): Promise<number> {
    return notificationRepository.countUnread(userId);
  },

  /** Idempotent; someone else's, hidden or unknown id -> 404 (no existence leak). */
  async markRead(userId: string, id: string, now: Date = new Date()): Promise<NotificationDto> {
    if (!(await notificationRepository.findVisible(userId, id))) throw notFound('Notification not found.');
    await notificationRepository.markRead(userId, id, now);
    const updated = await notificationRepository.findVisible(userId, id);
    if (!updated) throw notFound('Notification not found.');
    return toNotificationDto(updated);
  },

  async markAllRead(userId: string, now: Date = new Date()): Promise<void> {
    await notificationRepository.markAllRead(userId, now);
  },
};
