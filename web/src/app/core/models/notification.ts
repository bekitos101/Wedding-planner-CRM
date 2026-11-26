import { TaskStatus } from './task';

/** Named AppNotification to avoid clashing with the DOM `Notification` global. */
export interface AppNotification {
  id: string;
  type: 'TASK_DEADLINE_REMINDER';
  title: string;
  message: string;
  /** Frontend path, e.g. /weddings/<id>/tasks. */
  link: string;
  createdAt: string;
  readAt: string | null;
  task: { id: string; title: string; dueDate: string; status: TaskStatus };
  wedding: { id: string; coupleNames: string };
}
