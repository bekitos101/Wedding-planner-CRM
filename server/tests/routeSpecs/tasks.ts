import type { RouteSpec } from './types.js';

const TASK_ID = '33333333-3333-4333-8333-333333333333';
const TEMPLATE_ID = '44444444-4444-4444-8444-444444444444';

/**
 * Track 3B tasks, checklist apply: every route this track mounts under /weddings/:weddingId.
 *
 * PATCH task is listed as access 'owner' on purpose: the authorization loops use it to prove a
 * team member can't change protected fields (the body has `title`, so the service answers 403
 * before any lookup). The member-allowed path (status/progressNotes on an assigned task) is
 * covered by tests/tasks.test.ts. The archived loop (owner, random task id) expects 409.
 */
export const TASK_ROUTES: RouteSpec[] = [
  { name: 'GET tasks', method: 'get', pattern: '/weddings/:weddingId/tasks', path: (c) => `/api/weddings/${c.weddingId}/tasks`, access: 'member', write: false },
  {
    name: 'POST task',
    method: 'post',
    pattern: '/weddings/:weddingId/tasks',
    path: (c) => `/api/weddings/${c.weddingId}/tasks`,
    body: { title: 'Task', dueDate: '2030-01-01' },
    access: 'owner',
    write: true,
  },
  {
    name: 'PATCH task',
    method: 'patch',
    pattern: '/weddings/:weddingId/tasks/:taskId',
    path: (c) => `/api/weddings/${c.weddingId}/tasks/${TASK_ID}`,
    body: { title: 'X' },
    access: 'owner',
    write: true,
  },
  {
    name: 'DELETE task',
    method: 'delete',
    pattern: '/weddings/:weddingId/tasks/:taskId',
    path: (c) => `/api/weddings/${c.weddingId}/tasks/${TASK_ID}`,
    access: 'owner',
    write: true,
  },
  {
    name: 'POST apply checklist template',
    method: 'post',
    pattern: '/weddings/:weddingId/checklist-templates/:templateId/apply',
    path: (c) => `/api/weddings/${c.weddingId}/checklist-templates/${TEMPLATE_ID}/apply`,
    body: {},
    access: 'owner',
    write: true,
  },
];
