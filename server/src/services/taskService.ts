import type { TaskPriority, TaskStatus } from '@prisma/client';
import { todayUtc } from '../lib/dates.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { formatDateOnly } from '../lib/schemas.js';
import {
  taskRepository,
  type NewTaskData,
  type TaskListFilter,
  type TaskRow,
  type TaskTx,
  type TaskUpdateData,
} from '../repositories/taskRepository.js';
import type { WeddingRole } from './weddingDto.js';
import { reminderService } from './reminderService.js';
import { ARCHIVED_MESSAGE } from './weddingService.js';

export const MEMBER_TASK_FIELDS: readonly string[] = ['status', 'progressNotes'];
export const MEMBER_TASK_FORBIDDEN_MESSAGE =
  'Team members can only change the status and progress notes of tasks assigned to them.';
const ASSIGNEE_MESSAGE = 'Assignee must be the owner or an active team member.';

export function toTaskDto(t: TaskRow, today: Date = todayUtc()) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    dueDate: formatDateOnly(t.dueDate) as string,
    priority: t.priority,
    status: t.status,
    progressNotes: t.progressNotes,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    // Derived on every read, never stored (FR-35, FR-59).
    isOverdue: t.status !== 'COMPLETED' && t.dueDate.getTime() < today.getTime(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
export type TaskDto = ReturnType<typeof toTaskDto>;

/**
 * Reminder hook points (FR-61/62, BR-09/10/13): every task write in the app goes through the two
 * functions below, inside the same transaction as the write. create/reschedule/complete/reopen/
 * reassign -> syncTask makes the stored reminders match the task. `previous` is the row before the
 * update (null for a newly created task); syncTask works from the stored state, so it isn't needed.
 */
async function onTaskSaved(tx: TaskTx, task: TaskRow, _previous: TaskRow | null): Promise<void> {
  await reminderService.syncTask(tx.reminders, task.id);
}
async function onTaskDeleted(_tx: TaskTx, _task: TaskRow): Promise<void> {
  // Reminders of a deleted task go with it (Notification.task onDelete: Cascade).
}

export interface TaskContext {
  wedding: { id: string; status: 'ACTIVE' | 'ARCHIVED' };
  role: WeddingRole;
  userId: string;
}

export interface CreateTaskInput {
  title: string;
  description: string | null;
  dueDate: Date;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigneeId?: string | null;
}

export type UpdateTaskInput = Partial<{
  title: string;
  description: string | null;
  dueDate: Date;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeId: string | null;
  progressNotes: string | null;
}>;

export interface ListTasksQuery {
  assignee?: string; // 'me' | 'unassigned' | user id
  status?: TaskStatus;
  overdue?: boolean;
}

/** Owner/active-member check inside the writing transaction (UC-07). */
async function assertAssignable(tx: TaskTx, weddingId: string, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const access = await tx.lockWeddingAndMembership(weddingId, assigneeId);
  const allowed = access !== null && (access.ownerId === assigneeId || access.memberStatus === 'ACTIVE');
  if (!allowed) throw validationError(ASSIGNEE_MESSAGE, { assigneeId: ASSIGNEE_MESSAGE });
}

/** Locks the wedding row and reports whether it is ACTIVE (BR-13). */
async function isActive(tx: TaskTx, weddingId: string): Promise<boolean> {
  return (await tx.lockWeddingStatus(weddingId)) === 'ACTIVE';
}

async function assertActive(tx: TaskTx, weddingId: string): Promise<void> {
  if (!(await isActive(tx, weddingId))) throw conflict(ARCHIVED_MESSAGE);
}

/**
 * BR-03 / CLAUDE.md rule 3: a team member's body may contain only status and progressNotes.
 * Call this BEFORE validating values, so a forbidden key is always 403 (never 400).
 */
function assertMemberKeys(role: WeddingRole, presentKeys: readonly string[]): void {
  if (role !== 'OWNER' && presentKeys.some((k) => !MEMBER_TASK_FIELDS.includes(k))) {
    throw forbidden(MEMBER_TASK_FORBIDDEN_MESSAGE);
  }
}

/** completedAt follows the status: set on entering COMPLETED, cleared on leaving it. */
function completedAtFor(previous: TaskStatus | null, next: TaskStatus, now: Date): Date | null | undefined {
  if (next === 'COMPLETED') return previous === 'COMPLETED' ? undefined : now;
  return null;
}

export const taskService = {
  /** Route calls this before zod validation of a PATCH body (forbidden keys beat validation errors). */
  assertPatchKeysAllowed: assertMemberKeys,

  async list(weddingId: string, userId: string, q: ListTasksQuery): Promise<TaskDto[]> {
    const today = todayUtc();
    const filter: TaskListFilter = {};
    if (q.assignee) filter.assignee = q.assignee === 'me' ? userId : q.assignee;
    if (q.status) filter.status = q.status;
    if (q.overdue) filter.overdueBefore = today;
    const rows = await taskRepository.list(weddingId, filter);
    return rows.map((t) => toTaskDto(t, today));
  },

  /** Owner only (route guard). */
  async create(ctx: TaskContext, input: CreateTaskInput, now: Date = new Date()): Promise<TaskDto> {
    if (ctx.role !== 'OWNER') throw forbidden('Only the wedding owner can do this.');
    const status = input.status ?? 'TODO';
    const data: NewTaskData = {
      title: input.title,
      description: input.description,
      dueDate: input.dueDate,
      priority: input.priority ?? 'MEDIUM',
      status,
      assigneeId: input.assigneeId ?? null,
      completedAt: status === 'COMPLETED' ? now : null,
    };
    const created = await taskRepository.transaction(async (tx) => {
      await assertActive(tx, ctx.wedding.id);
      await assertAssignable(tx, ctx.wedding.id, data.assigneeId);
      const task = await tx.create(ctx.wedding.id, data);
      await onTaskSaved(tx, task, null);
      return task;
    });
    return toTaskDto(created);
  },

  /**
   * Owner: any field. Team member (BR-03, FR-15/16, AC-03/04): only `status` / `progressNotes`
   * on a task assigned to them. `presentKeys` = every key that was in the request body, so a
   * forbidden field is rejected (403) even when its value is unchanged or invalid.
   */
  async update(
    ctx: TaskContext,
    taskId: string,
    patch: UpdateTaskInput,
    presentKeys: readonly string[],
    now: Date = new Date(),
  ): Promise<TaskDto> {
    const isOwner = ctx.role === 'OWNER';
    assertMemberKeys(ctx.role, presentKeys);

    const updated = await taskRepository.transaction(async (tx) => {
      const active = await isActive(tx, ctx.wedding.id);
      // Owner: archived -> 409 straight away. Member: 404 / 403 first, then 409 (401 > 404 > 403 > 409).
      if (isOwner && !active) throw conflict(ARCHIVED_MESSAGE);
      const existing = await tx.findById(ctx.wedding.id, taskId);
      if (!existing) throw notFound('Task not found.');
      if (!isOwner && existing.assigneeId !== ctx.userId) throw forbidden(MEMBER_TASK_FORBIDDEN_MESSAGE);
      if (!active) throw conflict(ARCHIVED_MESSAGE);

      await assertAssignable(tx, ctx.wedding.id, patch.assigneeId);

      const data: TaskUpdateData = {};
      if (patch.title !== undefined) data.title = patch.title;
      if (patch.description !== undefined) data.description = patch.description;
      if (patch.dueDate !== undefined) data.dueDate = patch.dueDate;
      if (patch.priority !== undefined) data.priority = patch.priority;
      if (patch.assigneeId !== undefined) data.assigneeId = patch.assigneeId;
      if (patch.progressNotes !== undefined) data.progressNotes = patch.progressNotes;
      if (patch.status !== undefined) {
        data.status = patch.status;
        const completedAt = completedAtFor(existing.status, patch.status, now);
        if (completedAt !== undefined) data.completedAt = completedAt;
      }
      if (Object.keys(data).length === 0) return existing;

      const task = await tx.update(ctx.wedding.id, taskId, data);
      if (!task) throw notFound('Task not found.');
      await onTaskSaved(tx, task, existing);
      return task;
    });
    return toTaskDto(updated);
  },

  /** Owner only (route guard). */
  async remove(ctx: TaskContext, taskId: string): Promise<void> {
    if (ctx.role !== 'OWNER') throw forbidden('Only the wedding owner can do this.');
    await taskRepository.transaction(async (tx) => {
      await assertActive(tx, ctx.wedding.id);
      const existing = await tx.findById(ctx.wedding.id, taskId);
      if (!existing) throw notFound('Task not found.');
      await onTaskDeleted(tx, existing);
      await tx.delete(ctx.wedding.id, taskId);
    });
  },

  /**
   * Creates several tasks in ONE transaction (used by checklist templates, FR-37). Same write
   * path and hooks as `create`, so phase 5 reminders cover template tasks too.
   */
  async createBatch(weddingId: string, rows: NewTaskData[]): Promise<TaskDto[]> {
    const created = await taskRepository.transaction(async (tx) => {
      await assertActive(tx, weddingId);
      const tasks = await tx.createMany(weddingId, rows);
      for (const t of tasks) await onTaskSaved(tx, t, null);
      return tasks;
    });
    const today = todayUtc();
    return created.map((t) => toTaskDto(t, today));
  },
};
