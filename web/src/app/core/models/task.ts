import { DateOnly } from './wedding';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'COMPLETED';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueDate: DateOnly;
  priority: TaskPriority;
  status: TaskStatus;
  progressNotes: string | null;
  assignee: { id: string; name: string } | null;
  isOverdue: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  description?: string;
  dueDate: DateOnly;
  priority?: TaskPriority;
  status?: TaskStatus;
  progressNotes?: string;
  assigneeId?: string | null;
}

/** What a team member may send (BR-03): nothing else. */
export interface TaskMemberPatch {
  status?: TaskStatus;
  progressNotes?: string;
}

export interface TaskFilters {
  assignee?: 'me' | 'unassigned';
  status?: TaskStatus;
  overdue?: boolean;
}

export interface TemplateItem {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  daysBeforeWedding: number;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  items: TemplateItem[];
}
