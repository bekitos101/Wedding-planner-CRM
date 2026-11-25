import type { TaskPriority, TaskStatus } from '@prisma/client';
import type { SeedContext } from './context.js';

const DAY_MS = 86_400_000;
const daysFromNow = (days: number): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY_MS);
};

interface DemoTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  days: number; // due date relative to today (negative = overdue when not completed)
  assignee?: 'member' | 'owner';
  progressNotes?: string;
}

const WEDDING_1: DemoTask[] = [
  { id: '00000000-0000-4000-8000-0000000b0001', title: 'Book the florist', status: 'TODO', priority: 'MEDIUM', days: 30 },
  {
    id: '00000000-0000-4000-8000-0000000b0002',
    title: 'Finalise the menu tasting',
    description: 'Confirm dates with the caterer.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    days: 12,
    assignee: 'member',
    progressNotes: 'Tasting proposed for the second weekend.',
  },
  { id: '00000000-0000-4000-8000-0000000b0003', title: 'Order the wedding cake', status: 'TODO', priority: 'LOW', days: 60, assignee: 'member' },
  { id: '00000000-0000-4000-8000-0000000b0004', title: 'Confirm the DJ playlist', status: 'TODO', priority: 'LOW', days: 90 },
  { id: '00000000-0000-4000-8000-0000000b0005', title: 'Send the save-the-dates', status: 'TODO', priority: 'HIGH', days: -5, assignee: 'owner' }, // overdue (FR-35)
  { id: '00000000-0000-4000-8000-0000000b0006', title: 'Choose the wedding rings', status: 'COMPLETED', priority: 'MEDIUM', days: -20 },
];

const WEDDING_2: DemoTask[] = [
  { id: '00000000-0000-4000-8000-0000000b0007', title: 'Visit the venue', status: 'COMPLETED', priority: 'HIGH', days: -10, assignee: 'owner' },
  { id: '00000000-0000-4000-8000-0000000b0008', title: 'Book the band', status: 'IN_PROGRESS', priority: 'MEDIUM', days: 40 },
  { id: '00000000-0000-4000-8000-0000000b0009', title: 'Arrange guest transport', status: 'TODO', priority: 'LOW', days: 75 },
];

/** Track 3B tasks demo data. Idempotent: fixed uuids + upserts, so re-running never duplicates. */
export async function seedTasks(ctx: SeedContext): Promise<void> {
  const { prisma } = ctx;
  const plan: [string, DemoTask[]][] = [
    [ctx.wedding1Id, WEDDING_1],
    [ctx.wedding2Id, WEDDING_2],
  ];
  for (const [weddingId, tasks] of plan) {
    for (const t of tasks) {
      const data = {
        weddingId,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        priority: t.priority,
        dueDate: daysFromNow(t.days),
        progressNotes: t.progressNotes ?? null,
        assigneeId: t.assignee === 'member' ? ctx.memberId : t.assignee === 'owner' ? ctx.ownerId : null,
        completedAt: t.status === 'COMPLETED' ? daysFromNow(t.days) : null,
      };
      await prisma.task.upsert({ where: { id: t.id }, update: {}, create: { id: t.id, ...data } });
    }
  }
}
