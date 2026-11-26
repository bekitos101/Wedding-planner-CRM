import { AppNotification } from '../models/notification';

export function makeNotification(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    type: 'TASK_DEADLINE_REMINDER',
    title: 'Task due in 3 days',
    message: '"Book the venue" is due on 19 Jun 2027 — Emma & Daniel.',
    link: '/weddings/w1/tasks',
    createdAt: new Date().toISOString(),
    readAt: null,
    task: { id: 't1', title: 'Book the venue', dueDate: '2027-06-19', status: 'TODO' },
    wedding: { id: 'w1', coupleNames: 'Emma & Daniel' },
    ...over,
  };
}
