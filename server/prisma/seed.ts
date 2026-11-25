import bcrypt from 'bcryptjs';
import { PrismaClient, type TaskPriority } from '@prisma/client';

const prisma = new PrismaClient();

const WEDDING_1_ID = '00000000-0000-4000-8000-000000000001';
const WEDDING_2_ID = '00000000-0000-4000-8000-000000000002';

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

function monthsFromNow(months: number): Date {
  const d = new Date();
  d.setUTCHours(15, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

async function main() {
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

  const weddings = [
    { id: WEDDING_1_ID, coupleNames: 'Emma & Daniel', months: 6, location: 'Lake Balaton Manor', totalBudget: '25000.00' },
    { id: WEDDING_2_ID, coupleNames: 'Sofia & Marco', months: 10, location: 'Budapest Riverside Hall', totalBudget: '18000.00' },
  ];
  for (const w of weddings) {
    const weddingDate = monthsFromNow(w.months);
    const rsvpDeadline = new Date(weddingDate);
    rsvpDeadline.setUTCMonth(rsvpDeadline.getUTCMonth() - 1);
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

  console.log('Seed complete: 2 users, 2 weddings, 1 membership, 2 checklist templates.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
