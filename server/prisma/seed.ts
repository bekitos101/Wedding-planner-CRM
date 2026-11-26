import bcrypt from 'bcryptjs';
import { PrismaClient, type TaskPriority } from '@prisma/client';
import { seedBudget } from './seeds/budget.js';
import { seedDemo } from './seeds/demo.js';
import { seedGuests } from './seeds/guests.js';
import { seedPlanning } from './seeds/planning.js';
import { seedTasks } from './seeds/tasks.js';
import { prisma as appPrisma } from '../src/lib/prisma.js';
import { reminderService } from '../src/services/reminderService.js';

const prisma = new PrismaClient();

const WEDDING_1_ID = '00000000-0000-4000-8000-000000000001';
const WEDDING_2_ID = '00000000-0000-4000-8000-000000000002';
const WEDDING_3_ID = '00000000-0000-4000-8000-000000000003';
const WEDDING_4_ID = '00000000-0000-4000-8000-000000000004';

type Item = [title: string, priority: TaskPriority, daysBeforeWedding: number, description?: string];

const templates: { name: string; description: string; items: Item[] }[] = [
  {
    name: '12-month classic wedding checklist',
    description: 'A full year of planning milestones for a classic wedding.',
    items: [
      ['Set the budget and guest-count estimate', 'HIGH', 365, 'Agree total budget and rough guest list size with the couple.'],
      ['Book the ceremony and reception venues', 'HIGH', 330],
      ['Hire the photographer and videographer', 'HIGH', 300],
      ['Book the caterer and schedule a tasting', 'HIGH', 270],
      ['Choose the band or DJ', 'MEDIUM', 240],
      ['Send save-the-date notices', 'MEDIUM', 210],
      ['Order wedding attire and accessories', 'MEDIUM', 180],
      ['Book florist and decorations', 'MEDIUM', 150],
      ['Send formal invitations', 'HIGH', 90, 'Include the RSVP link and deadline.'],
      ['Finalise menu and cake order', 'MEDIUM', 60],
      ['Confirm final guest count with caterer', 'HIGH', 21],
      ['Rehearsal and final walkthrough with suppliers', 'HIGH', 3],
    ],
  },
  {
    name: 'Short engagement (3 months)',
    description: 'A compressed plan for couples with about three months to prepare.',
    items: [
      ['Fix the budget and the guest list', 'HIGH', 90],
      ['Secure a venue and a date-holding deposit', 'HIGH', 85],
      ['Book the photographer and caterer', 'HIGH', 75],
      ['Send invitations with RSVP link', 'HIGH', 60],
      ['Buy attire and arrange fittings', 'MEDIUM', 45],
      ['Order flowers, cake and decorations', 'MEDIUM', 30],
      ['Confirm guest count and seating plan', 'HIGH', 14],
      ['Prepare the wedding-day schedule and brief suppliers', 'HIGH', 5],
    ],
  },
];

async function main() {
  // The demo accounts have a public password (NFR-01): never seed a production database.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the demo seed with NODE_ENV=production.');
  }
  const passwordHash = await bcrypt.hash('Password123!', 12);

  // passwordHash is not overwritten on re-runs
  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.test' },
    update: { name: 'Olivia Owner' },
    create: { name: 'Olivia Owner', email: 'owner@demo.test', passwordHash },
  });
  const member = await prisma.user.upsert({
    where: { email: 'member@demo.test' },
    update: { name: 'Tom Teammate' },
    create: { name: 'Tom Teammate', email: 'member@demo.test', passwordHash },
  });

  const mkUser = (name: string, email: string) =>
    prisma.user.upsert({ where: { email }, update: { name }, create: { name, email, passwordHash } });
  const assistant = await mkUser('Anna Assistant', 'assistant@demo.test');
  const former = await mkUser('Mark Former', 'former@demo.test');
  const planner2 = await mkUser('Peter Planner', 'planner2@demo.test');

  const weddings = [
    { id: WEDDING_1_ID, coupleNames: 'Emma & Daniel', weddingDate: '2027-06-19', rsvpDeadline: '2027-05-19', location: 'Lake Balaton Manor', totalBudget: '25000.00' },
    { id: WEDDING_2_ID, coupleNames: 'Sofia & Marco', weddingDate: '2027-09-25', rsvpDeadline: '2027-08-25', location: 'Budapest Riverside Hall', totalBudget: '18000.00' },
  ];
  for (const w of weddings) {
    // Calendar dates (@db.Date): fixed "YYYY-MM-DD" values keep the seed idempotent.
    const weddingDate = new Date(`${w.weddingDate}T00:00:00.000Z`);
    const rsvpDeadline = new Date(`${w.rsvpDeadline}T00:00:00.000Z`);
    await prisma.wedding.upsert({
      where: { id: w.id },
      update: {},
      create: {
        id: w.id,
        ownerId: owner.id,
        coupleNames: w.coupleNames,
        weddingDate,
        rsvpDeadline,
        location: w.location,
        totalBudget: w.totalBudget,
      },
    });
  }

  await prisma.weddingMember.upsert({
    where: { weddingId_userId: { weddingId: WEDDING_1_ID, userId: member.id } },
    update: {},
    create: { weddingId: WEDDING_1_ID, userId: member.id },
  });
  // Wedding 3 is archived (Archived tab); wedding 4 belongs to a different planner (isolation demo).
  const extra = [
    { id: WEDDING_3_ID, ownerId: owner.id, coupleNames: 'Lili & Bence', weddingDate: '2026-09-12', rsvpDeadline: '2026-08-12', location: 'Szentendre Vineyard Pavilion', totalBudget: '12000.00', archived: true },
    { id: WEDDING_4_ID, ownerId: planner2.id, coupleNames: 'Judit & Andras', weddingDate: '2027-08-14', rsvpDeadline: '2027-07-14', location: 'Eger Winery Estate', totalBudget: '9000.00', archived: false },
  ];
  for (const w of extra) {
    await prisma.wedding.upsert({
      where: { id: w.id },
      update: {},
      create: {
        id: w.id, ownerId: w.ownerId, coupleNames: w.coupleNames, location: w.location, totalBudget: w.totalBudget,
        weddingDate: new Date(`${w.weddingDate}T00:00:00.000Z`), rsvpDeadline: new Date(`${w.rsvpDeadline}T00:00:00.000Z`),
        ...(w.archived ? { status: 'ARCHIVED' as const, archivedAt: new Date('2026-09-20T09:00:00.000Z') } : {}),
      },
    });
  }
  for (const [weddingId, userId, revoked] of [
    [WEDDING_1_ID, assistant.id, false],
    [WEDDING_2_ID, assistant.id, false],
    [WEDDING_1_ID, former.id, true],
  ] as const) {
    await prisma.weddingMember.upsert({
      where: { weddingId_userId: { weddingId, userId } },
      update: {},
      create: { weddingId, userId, ...(revoked ? { status: 'REVOKED' as const, revokedAt: new Date('2026-10-01T08:00:00.000Z') } : {}) },
    });
  }

  // Demo tasks for wedding 1 (fixed ids, idempotent) so the list shows non-zero progress (FR-10).
  const demoTasks: [string, string, 'TODO' | 'IN_PROGRESS' | 'COMPLETED', number][] = [
    ['00000000-0000-4000-8000-0000000000a1', 'Book the venue', 'COMPLETED', 20],
    ['00000000-0000-4000-8000-0000000000a2', 'Hire the photographer', 'IN_PROGRESS', 45],
    ['00000000-0000-4000-8000-0000000000a3', 'Choose the caterer', 'TODO', 70],
    ['00000000-0000-4000-8000-0000000000a4', 'Send invitations', 'TODO', 100],
  ];
  for (const [id, title, status, days] of demoTasks) {
    const dueDate = new Date(Date.now() + days * 86400000);
    await prisma.task.upsert({
      where: { id },
      update: {},
      create: { id, weddingId: WEDDING_1_ID, title, status, dueDate, assigneeId: status === 'IN_PROGRESS' ? member.id : null },
    });
  }

  for (const t of templates) {
    const template = await prisma.checklistTemplate.upsert({
      where: { name: t.name },
      update: { description: t.description },
      create: { name: t.name, description: t.description },
    });
    for (const [i, [title, priority, daysBeforeWedding, description]] of t.items.entries()) {
      await prisma.checklistTemplateItem.upsert({
        where: { templateId_sortOrder: { templateId: template.id, sortOrder: i + 1 } },
        update: { title, priority, daysBeforeWedding, description },
        create: { templateId: template.id, sortOrder: i + 1, title, priority, daysBeforeWedding, description },
      });
    }
  }

  // Phase 3 tracks add their demo data in prisma/seeds/<track>.ts (don't edit this file).
  const ctx = {
    prisma, ownerId: owner.id, memberId: member.id, wedding1Id: WEDDING_1_ID, wedding2Id: WEDDING_2_ID,
    assistantId: assistant.id, formerId: former.id, planner2Id: planner2.id, wedding3Id: WEDDING_3_ID, wedding4Id: WEDDING_4_ID,
  };
  await seedGuests(ctx);
  await seedTasks(ctx);
  await seedBudget(ctx);
  await seedPlanning(ctx);
  const demo = await seedDemo(ctx);

  // Phase 5: reminders for the demo tasks (same code path as the server's startup backfill). Idempotent.
  const reminderTasks = await reminderService.syncAllReminders();
  // Demo only: give the bell some history. IN_APP reminders that are already due count as delivered
  // at their scheduled time; EMAIL reminders stay PENDING for the reminder job to send. Only done when
  // NODE_ENV=development (the default in .env). A re-run finds nothing PENDING and due, so counts don't change.
  let demoDelivered = 0;
  if (process.env.NODE_ENV === 'development') {
    demoDelivered = await prisma.$executeRaw`UPDATE "Notification" SET "status" = 'SENT', "sentAt" = "scheduledAt"
      WHERE "channel" = 'IN_APP' AND "status" = 'PENDING' AND "scheduledAt" <= now()`;
  }
  console.log(`Reminders synced for ${reminderTasks} tasks; ${demoDelivered} demo in-app notifications marked delivered.`);

  console.log('Seed complete: 5 users, 4 weddings (1 archived), memberships, 2 checklist templates, demo data.');
  if (demo.rsvpUrls.length > 0) {
    console.log('\nDemo RSVP links (demo-only, not created in production):');
    for (const u of demo.rsvpUrls) console.log(`  ${u.label}: ${u.url}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await appPrisma.$disconnect();
  });
