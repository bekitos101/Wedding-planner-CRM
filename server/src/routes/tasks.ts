import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { currentUserId, requireAuth } from '../middleware/auth.js';
import { notFound } from '../lib/errors.js';
import { parseUuidParam, UUID_RE } from '../lib/ids.js';
import { dateOnly, optionalText, requiredText } from '../lib/schemas.js';
import { validate } from '../lib/validate.js';
import { currentWeddingId, ownerWriteAccess } from '../middleware/wedding.js';
import { checklistService } from '../services/checklistService.js';
import { taskService, type TaskContext } from '../services/taskService.js';

const priority = z.enum(['LOW', 'MEDIUM', 'HIGH'], { error: 'Priority must be LOW, MEDIUM or HIGH' });
const status = z.enum(['TODO', 'IN_PROGRESS', 'COMPLETED'], { error: 'Status must be TODO, IN_PROGRESS or COMPLETED' });
const assigneeId = z.string({ error: 'Assignee must be a user id' }).regex(UUID_RE, 'Assignee must be a user id').transform((s) => s.toLowerCase()).nullable();

const taskFields = {
  title: requiredText('Title', 200),
  description: optionalText('Description', 2000),
  dueDate: dateOnly('Due date'),
  priority,
  status,
  assigneeId,
  progressNotes: optionalText('Progress notes', 2000),
};

const createBody = z.object({
  title: taskFields.title,
  description: taskFields.description,
  dueDate: taskFields.dueDate,
  priority: taskFields.priority.optional(),
  status: taskFields.status.optional(),
  assigneeId: taskFields.assigneeId.optional(),
});
const ownerPatchBody = z.object(taskFields).partial();
// Team members: only these two are validated; every other key is rejected by the service (403).
const memberPatchBody = z.object({ status: taskFields.status, progressNotes: taskFields.progressNotes }).partial();

const listQuery = z.object({
  assignee: z
    .union([z.literal('me'), z.literal('unassigned'), z.string().regex(UUID_RE).transform((s) => s.toLowerCase())], {
      error: 'assignee must be "me", "unassigned" or a user id',
    })
    .optional(),
  status: status.optional(),
  overdue: z.enum(['true', 'false'], { error: 'overdue must be true or false' }).transform((v) => v === 'true').optional(),
});

function context(req: Request): TaskContext {
  return { wedding: req.wedding!, role: req.weddingRole!, userId: currentUserId(req) };
}

const taskId = (req: Request): string => {
  const id = parseUuidParam(req.params.taskId);
  if (!id) throw notFound('Task not found.');
  return id;
};

// Track 3B — tasks and applying checklist templates (wedding-scoped, mounted at the ROOT of
// weddingScoped, so requireAuth -> loadWedding -> requireMember already ran).
export const tasksRouter = Router({ mergeParams: true });

tasksRouter.get('/tasks', async (req, res, next) => {
  try {
    const { query } = validate(req, { query: listQuery });
    res.json(await taskService.list(currentWeddingId(req), currentUserId(req), query));
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/tasks', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: createBody });
    res.status(201).json(await taskService.create(context(req), body));
  } catch (err) {
    next(err);
  }
});

// Team members may call this: they pass the route guard and the SERVICE enforces BR-03
// (own task, only status/progressNotes, else 403). The archived check (409) is in the service too,
// after the 403 checks, so a member's forbidden field is still a 403 on an archived wedding.
tasksRouter.patch('/tasks/:taskId', async (req, res, next) => {
  try {
    const id = taskId(req);
    const ctx = context(req);
    const raw: unknown = req.body;
    const presentKeys = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw) : [];
    taskService.assertPatchKeysAllowed(ctx.role, presentKeys); // 403 before any value validation (rule 3)
    const schema = ctx.role === 'OWNER' ? ownerPatchBody : memberPatchBody;
    const { body } = validate(req, { body: schema });
    res.json(await taskService.update(ctx, id, body, presentKeys));
  } catch (err) {
    next(err);
  }
});

tasksRouter.delete('/tasks/:taskId', ...ownerWriteAccess, async (req, res, next) => {
  try {
    await taskService.remove(context(req), taskId(req));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

tasksRouter.post('/checklist-templates/:templateId/apply', ...ownerWriteAccess, async (req, res, next) => {
  try {
    const templateId = parseUuidParam(req.params.templateId);
    if (!templateId) throw notFound('Checklist template not found.');
    res.status(201).json(await checklistService.apply(currentWeddingId(req), templateId));
  } catch (err) {
    next(err);
  }
});

// GET /checklist-templates — any logged-in user. Mounted on apiRouter.
export const checklistTemplatesRouter = Router();

checklistTemplatesRouter.get('/checklist-templates', requireAuth, async (_req, res, next) => {
  try {
    res.json(await checklistService.list());
  } catch (err) {
    next(err);
  }
});
