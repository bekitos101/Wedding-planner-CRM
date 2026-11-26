import { createHash, randomBytes } from 'node:crypto';
import type { DeliveryStatus, Prisma, RsvpStatus, TaskPriority, TaskStatus } from '@prisma/client';
import type { SeedContext } from './context.js';

/**
 * Rich demo data on top of the base seeds (guests/tasks/budget/planning). Additive and idempotent:
 * every row has a fixed uuid and is written with createMany({ skipDuplicates }), so re-running
 * `npm run db:seed` never duplicates or moves anything. Relative due dates ("3 days from now") are
 * computed when the row is FIRST created and are not touched on re-runs.
 * Fictional people only; emails use example/test domains.
 */

const DAY_MS = 86_400_000;
const uid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
const daysFromNow = (days: number): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY_MS);
};
const slug = (name: string) => name.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');

// ---- Demo-only RSVP tokens ------------------------------------------------------------------
// Fixed 32-byte values (base64url, 43 chars) so the user can open the public RSVP page directly.
// ONLY the SHA-256 hash is stored, exactly like the app does. NEVER created in production.
const demoToken = (label: string) => Buffer.from(label.padEnd(32, '#')).subarray(0, 32).toString('base64url');
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
const DEMO_OPEN_TOKEN = demoToken('demo-rsvp-open-wedding-one');
const DEMO_ARCHIVED_TOKEN = demoToken('demo-rsvp-archived-wedding');

// ---- Guests ---------------------------------------------------------------------------------
// Invitation codes: S sent, F failed, R revoked, P pending (not delivered yet), - not invited.
type Inv = 'S' | 'F' | 'R' | 'P' | '-';
type G = [n: number, name: string, rsvp: 'A' | 'D' | 'P', inv: Inv, dietary?: string, email?: string];
const RSVP: Record<'A' | 'D' | 'P', RsvpStatus> = { A: 'ACCEPTED', D: 'DECLINED', P: 'PENDING' };

// Wedding 1: guests 1-10 come from the base seed (guests.ts); 11-40 are added here.
const W1_EXISTING_INV: [number, Inv][] = [[1, 'S'], [2, 'S'], [3, 'S'], [4, 'S'], [5, 'S'], [6, 'S'], [7, 'F'], [8, 'S'], [9, 'S'], [10, '-']];
const W1_GUESTS: G[] = [
  [11, 'Gabor Kiss', 'A', 'S'], [12, 'Katalin Szilagyi', 'A', 'S', 'Vegan'], [13, 'Laszlo Meszaros', 'P', 'S'],
  [14, 'Maria Fekete', 'A', 'S'], [15, 'Nora Lukacs', 'D', 'S'], [16, 'Orsolya Gal', 'A', 'S', 'Nut allergy (severe)'],
  [17, 'Peter Szucs', 'A', 'S'], [18, 'Reka Juhasz', 'P', 'S'], [19, 'Sandor Illes', 'A', 'S', 'Lactose-free'],
  [20, 'Tamara Bognar', 'A', 'S'], [21, 'Ulrich Becker', 'A', 'F', 'Pescatarian'], [22, 'Viktoria Pinter', 'D', 'S'],
  [23, 'Zoltan Racz', 'A', 'S', 'Halal'], [24, 'Agnes Vincze', 'P', 'R'], [25, 'Balint Orosz', 'A', 'S'],
  [26, 'Cecilia Lakatos', 'A', 'S', 'Kosher'], [27, 'Dora Simon', 'P', 'P'], [28, 'Emil Rado', 'A', 'S', 'Vegetarian'],
  [29, 'Flora Kelemen', 'A', 'S'], [30, 'Gergo Sipos', 'D', 'S'], [31, 'Hedvig Boros', 'P', '-'],
  [32, 'Imre Antal', 'A', 'S', undefined, 'antal.family@example.com'], [33, 'Julia Antal', 'A', 'S', undefined, 'antal.family@example.com'],
  [34, 'Karoly Fazekas', 'P', '-'], [35, 'Lilla Jakab', 'A', 'S'], [36, 'Mate Biro', 'A', 'S'],
  [37, 'Noemi Hegedus', 'P', '-'], [38, 'Oliver Szalai', 'D', 'S'], [39, 'Petra Mezei', 'A', 'S'],
  [40, 'Rita Demo-Guest', 'P', 'S'], // demo RSVP link (open): guest still PENDING
];
const W2_GUESTS: G[] = [
  [1, 'Zsofia Barta', 'A', 'S'], [2, 'Andras Kovacs-Nagy', 'A', 'S', 'Vegetarian'], [3, 'Bianka Toth', 'A', 'S'],
  [4, 'Csaba Revesz', 'D', 'S'], [5, 'Diana Szekely', 'A', 'S'], [6, 'Erik Vass', 'P', 'S'], [7, 'Fanni Domokos', 'A', 'S', 'Gluten-free'],
  [8, 'Gyorgy Katona', 'P', 'S'], [9, 'Henrietta Bak', 'A', 'S'], [10, 'Ivan Gulyas', 'P', 'F'], [11, 'Johanna Torok', 'A', 'S'],
  [12, 'Kristof Lengyel', 'D', 'S'], [13, 'Lenke Szabados', 'P', '-'], [14, 'Marton Deak', 'A', 'S'], [15, 'Nikolett Orban', 'A', 'S', 'Lactose-free'],
  [16, 'Oszkar Nemeth', 'P', '-'], [17, 'Pal Hajdu', 'A', 'S'], [18, 'Regina Kardos', 'P', 'P'], [19, 'Sara Budai', 'A', 'S'], [20, 'Tibor Mark', 'P', '-'],
];
const W3_GUESTS: G[] = [
  [1, 'Anett Somogyi', 'A', 'S'], [2, 'Botond Feher', 'A', 'S'], [3, 'Csenge Olah', 'A', 'S', 'Vegetarian'], [4, 'Denes Szoke', 'D', 'S'],
  [5, 'Edina Pap', 'A', 'S'], [6, 'Farkas Peto', 'A', 'S'], [7, 'Gyongyi Takacs', 'A', 'S'], [8, 'Hunor Bende', 'A', 'S'], // 8 = archived demo link
];
const W4_GUESTS: G[] = [[1, 'Aron Szeles', 'A', 'S'], [2, 'Boglarka Dudas', 'P', 'S'], [3, 'Cserna Kocsis', 'P', '-']];

// ---- Tasks ----------------------------------------------------------------------------------
type Who = 'o' | 't' | 'a';
// [title, status, priority, due (days from today, or an absolute date), assignee, progressNotes]
type T = [title: string, status: TaskStatus, priority: TaskPriority, due: number | string, who?: Who, notes?: string, templateSort?: number];
const W1_TASKS: T[] = [
  ['Confirm the cocktail-hour menu', 'TODO', 'MEDIUM', 2, 'a'],
  ['Collect the signed photographer contract', 'TODO', 'HIGH', 4, 'o'],
  ['Print the seating charts', 'TODO', 'MEDIUM', 6, 't'],
  ['Pay the videographer deposit', 'IN_PROGRESS', 'HIGH', -3, 'o', 'Invoice received, bank transfer scheduled.'],
  ['Book the guest shuttle bus', 'TODO', 'MEDIUM', -8, 'a'],
  ['Choose the ceremony music', 'IN_PROGRESS', 'MEDIUM', 25, 't', 'Shortlist of three pieces sent to the couple.'],
  ['Design the table decorations', 'IN_PROGRESS', 'LOW', 40, 'a', 'Mood board approved, sourcing candles.'],
  ['Write the wedding-day timeline', 'COMPLETED', 'HIGH', -12, 'o'],
  ['Reserve rooms for the family', 'COMPLETED', 'MEDIUM', -30],
  ['Taste the wedding cake samples', 'COMPLETED', 'LOW', -15, 't'],
  ['Order the welcome signs and menus', 'TODO', 'LOW', 55, 'a'],
  ['Arrange the hair and make-up trial', 'TODO', 'MEDIUM', 75],
  ['Book the honeymoon transfer', 'TODO', 'LOW', 110],
  ['Confirm the final guest count', 'TODO', 'HIGH', 140, 'o'],
  ['Prepare the guest welcome bags', 'IN_PROGRESS', 'LOW', 90, 't', 'First 20 bags packed.'],
];
// Wedding 2: the first six are copies of the "Short engagement (3 months)" template items (sourceTemplateItemId).
const W2_TASKS: T[] = [
  ['Fix the budget and the guest list', 'COMPLETED', 'HIGH', -40, 'o', undefined, 1],
  ['Secure a venue and a date-holding deposit', 'COMPLETED', 'HIGH', -30, 'o', undefined, 2],
  ['Book the photographer and caterer', 'IN_PROGRESS', 'HIGH', 10, 'a', 'Two caterer quotes received, comparing.', 3],
  ['Send invitations with RSVP link', 'TODO', 'HIGH', 18, 'o', undefined, 4],
  ['Buy attire and arrange fittings', 'TODO', 'MEDIUM', 35, 'a', undefined, 5],
  ['Order flowers, cake and decorations', 'TODO', 'MEDIUM', 50, undefined, undefined, 6],
  ['Choose the wedding favours', 'TODO', 'LOW', 60],
  ['Reserve a hotel block for guests', 'IN_PROGRESS', 'MEDIUM', 28, 'o', 'Hotel holds 15 rooms until next month.'],
  ['Plan the rehearsal dinner', 'TODO', 'MEDIUM', 70, 'a'],
];
const W3_TASKS: T[] = [
  ['Book the vineyard pavilion', 'COMPLETED', 'HIGH', '2025-12-01', 'o'],
  ['Hire the caterer', 'COMPLETED', 'HIGH', '2026-01-15', 'o'],
  ['Order flowers', 'COMPLETED', 'MEDIUM', '2026-06-20'],
  ['Send invitations', 'COMPLETED', 'HIGH', '2026-06-01', 'o'],
  ['Finalise the seating plan', 'COMPLETED', 'MEDIUM', '2026-08-25'],
  ['Settle all supplier invoices', 'COMPLETED', 'LOW', '2026-09-30', 'o'],
];
const W4_TASKS: T[] = [
  ['Visit the winery estate', 'COMPLETED', 'HIGH', -25, 'o'],
  ['Choose the caterer', 'IN_PROGRESS', 'MEDIUM', 30, 'o', 'Menu tasting planned.'],
  ['Send save-the-dates', 'TODO', 'LOW', 45],
];

// ---- Budget ---------------------------------------------------------------------------------
// [category, description, agreed, due (days from today or absolute), notes, payments [amount, date, notes]]
type Pay = [amount: string, date: string, notes?: string];
type E = [category: string, description: string, agreed: string, due: number | string, notes: string | undefined, pays: Pay[]];
const W1_EXPENSES: E[] = [
  ['Videography', 'Wedding film and drone footage', '1800.00', 5, 'Final instalment due soon.', [['600.00', '2026-10-12', 'Deposit']]],
  ['Decoration', 'Candles, linen and table decor', '1100.00', '2027-05-30', undefined, [['400.00', '2026-11-05', 'Deposit']]],
  ['Cake', 'Three-tier wedding cake', '480.00', '2027-06-12', 'Lemon and vanilla.', [['480.00', '2026-11-15', 'Paid in full']]],
  ['Transport', 'Guest shuttle buses (2 x 50 seats)', '650.00', '2027-06-01', undefined, []],
  ['Stationery', 'Invitations, menus and place cards', '380.00', '2026-10-20', undefined, [['380.00', '2026-10-18', 'Paid in full']]],
];
const W2_EXPENSES: E[] = [
  ['Catering', 'Dinner for 80 guests', '4200.00', '2027-09-10', undefined, [['1000.00', '2026-11-10', 'Booking deposit']]],
  ['Flowers', 'Bouquets and arch flowers', '900.00', '2027-09-15', undefined, [['300.00', '2026-11-12', 'Deposit']]],
  ['Music', 'DJ and sound system', '1200.00', '2027-09-25', undefined, []],
  ['Stationery', 'Invitations and menus', '450.00', '2027-07-30', undefined, []],
];
const W3_EXPENSES: E[] = [
  ['Venue', 'Vineyard pavilion hire', '4200.00', '2026-08-12', undefined, [['1500.00', '2025-12-02', 'Deposit'], ['2700.00', '2026-08-10', 'Final payment']]],
  ['Catering', 'Dinner for 60 guests', '3800.00', '2026-09-05', undefined, [['1200.00', '2026-01-20', 'Deposit'], ['2600.00', '2026-09-04', 'Final payment']]],
  ['Flowers', 'Bouquets and table flowers', '650.00', '2026-09-01', undefined, [['650.00', '2026-08-30', 'Paid in full']]],
  ['Photography', 'Photographer for the day', '1500.00', '2026-09-12', undefined, [['500.00', '2026-02-10', 'Deposit'], ['1000.00', '2026-09-13', 'Final payment']]],
];
const W4_EXPENSES: E[] = [
  ['Venue', 'Winery estate hire', '3500.00', '2027-07-01', undefined, [['700.00', '2026-11-02', 'Deposit']]],
  ['Catering', 'Winemaker dinner', '2400.00', '2027-08-01', undefined, []],
];

// ---- Suppliers [name, category, contact, quotedPrice, notes] ---------------------------------
type S = [name: string, category: string, contact: string | null, price: string | null, notes: string | null];
const W1_SUPPLIERS: S[] = [
  ['Tihany Film Works', 'Videography', 'office@tihanyfilm.example, +36 30 555 0141', '1800.00', 'Includes drone footage and a 5-minute highlight film.'],
  ['Rozsa Florist', 'Decoration', 'rozsa@rozsa-florist.example, +36 20 555 0142', '1100.00', 'Candles and linen included.'],
  ['Balaton Shuttle Service', 'Transport', '+36 70 555 0143', null, 'Quote requested for two 50-seat buses.'],
  ['Papirkert Print Studio', 'Stationery', 'hello@papirkert.example', '380.00', 'Invitations already delivered.'],
];
const W2_SUPPLIERS: S[] = [
  ['Duna Sound and Light', 'Music', 'booking@dunasound.example, +36 30 555 0151', '1200.00', 'DJ plus ceremony microphones.'],
  ['Margit Virag Florals', 'Flowers', '+36 20 555 0152', '900.00', null],
  ['Riverside Catering Kft.', 'Catering', 'sales@riversidecatering.example', '4200.00', 'Menu tasting on request.'],
];
const W3_SUPPLIERS: S[] = [
  ['Szentendre Pavilion Events', 'Venue', 'events@szentendre-pavilion.example, +36 26 555 0161', '4200.00', 'Wedding completed, invoices settled.'],
  ['Szolo Photo', 'Photography', '+36 30 555 0162', '1500.00', null],
];
const W4_SUPPLIERS: S[] = [['Eger Cellar Events', 'Venue', 'info@egercellar.example, +36 36 555 0171', null, 'Waiting for a quote.']];

// ---- Schedule (Europe/Budapest, CEST = UTC+2 in June/September: local time minus 2 h = UTC) --
// [title, startUtc, endUtc, location, notes]
type Sch = [title: string, start: string, end: string, location: string | null, notes: string | null];
const W1_SCHEDULE: Sch[] = [
  ['Speeches', '2027-06-19T16:30:00Z', '2027-06-19T17:15:00Z', 'Ballroom', 'Intentional overlap: speeches happen during dinner (18:30-19:15).'],
  ['Cake cutting', '2027-06-19T17:15:00Z', '2027-06-19T17:30:00Z', 'Ballroom', 'Starts right after the speeches (back-to-back, no overlap).'],
  ['Party and dance floor', '2027-06-19T18:00:00Z', '2027-06-19T21:30:00Z', 'Ballroom', 'Live band, 20:00-23:30.'],
  ['Late-night snack', '2027-06-19T21:30:00Z', '2027-06-19T22:00:00Z', 'Terrace', 'Goulash soup and pogacsa (23:30-00:00).'],
  ['Last song and farewell', '2027-06-19T22:00:00Z', '2027-06-19T22:15:00Z', 'Ballroom', 'Shuttle buses leave at 00:30.'],
];
const W2_SCHEDULE: Sch[] = [
  ['Ceremony', '2027-09-25T13:00:00Z', '2027-09-25T13:40:00Z', 'Riverside terrace', '15:00-15:40.'],
  ['Reception drinks', '2027-09-25T14:00:00Z', '2027-09-25T15:30:00Z', 'Riverside Hall foyer', '16:00-17:30.'],
  ['Dinner', '2027-09-25T16:00:00Z', '2027-09-25T18:00:00Z', 'Main hall', '18:00-20:00.'],
  ['Party', '2027-09-25T18:00:00Z', '2027-09-25T21:00:00Z', 'Main hall', 'Back-to-back with dinner (20:00-23:00).'],
];

export async function seedDemo(ctx: SeedContext): Promise<{ rsvpUrls: { label: string; url: string }[] }> {
  const { prisma } = ctx;
  const who = (w?: Who) => (w === 'o' ? ctx.ownerId : w === 't' ? ctx.memberId : w === 'a' ? ctx.assistantId : null);
  const dueOf = (d: number | string) => (typeof d === 'number' ? daysFromNow(d) : dateOnly(d));

  // Guests --------------------------------------------------------------------------------------
  const GP = { 1: '9a000001', 2: '9a000002', 3: '9a000003', 4: '9a000004' } as const;
  const guestRows = (weddingId: string, prefix: string, list: G[], respondedOn: string) =>
    list.map(([n, name, rsvp, , dietary, email]) => ({
      id: uid(prefix, n),
      weddingId,
      name,
      email: email ?? `${slug(name)}@example.com`,
      rsvpStatus: RSVP[rsvp],
      dietaryRequirements: dietary ?? null,
      respondedAt: rsvp === 'P' ? null : new Date(`${respondedOn}T${String(8 + (n % 10)).padStart(2, '0')}:15:00Z`),
    }));
  await prisma.guest.createMany({
    skipDuplicates: true,
    data: [
      ...guestRows(ctx.wedding1Id, GP[1], W1_GUESTS, '2026-11-05'),
      ...guestRows(ctx.wedding2Id, GP[2], W2_GUESTS, '2026-11-12'),
      ...guestRows(ctx.wedding3Id, GP[3], W3_GUESTS, '2026-07-10'),
      ...guestRows(ctx.wedding4Id, GP[4], W4_GUESTS, '2026-11-15'),
    ],
  });

  // Invitations (random tokens; only the hash is stored). guestId is unique, so re-runs skip them.
  const guest1Ids = '00000000-0000-4000-8a00-'; // base-seed guest ids (guests.ts)
  const invs: { guestId: string; code: Inv; idx: number }[] = [
    ...W1_EXISTING_INV.map(([n, code]) => ({ guestId: `${guest1Ids}${String(n).padStart(12, '0')}`, code, idx: n })),
    ...W1_GUESTS.map(([n, , , code]) => ({ guestId: uid(GP[1], n), code, idx: n })),
    ...W2_GUESTS.map(([n, , , code]) => ({ guestId: uid(GP[2], n), code, idx: n })),
    ...W3_GUESTS.map(([n, , , code]) => ({ guestId: uid(GP[3], n), code, idx: n })),
    ...W4_GUESTS.map(([n, , , code]) => ({ guestId: uid(GP[4], n), code, idx: n })),
  ].filter((i) => i.code !== '-');
  const demoIds = new Map<string, string>([
    [uid(GP[1], 40), sha256(DEMO_OPEN_TOKEN)],
    [uid(GP[3], 8), sha256(DEMO_ARCHIVED_TOKEN)],
  ]);
  const isProd = process.env.NODE_ENV === 'production';
  const invData = invs
    .filter((i) => isProd === false || !demoIds.has(i.guestId))
    .map(({ guestId, code, idx }) => {
      const sentAt = new Date(Date.UTC(2026, 9, 10 + (idx % 12), 9, 30));
      const delivery: DeliveryStatus = code === 'F' ? 'FAILED' : code === 'P' ? 'PENDING' : 'SENT';
      return {
        guestId,
        // Demo-only fixed tokens (documented above) are skipped in production.
        tokenHash: demoIds.get(guestId) ?? sha256(randomBytes(32).toString('base64url')),
        deliveryStatus: delivery,
        attemptCount: code === 'F' ? 3 : code === 'P' ? 0 : 1,
        lastSentAt: code === 'P' ? null : sentAt,
        lastError: code === 'F' ? 'The email server could not be reached.' : null,
        revokedAt: code === 'R' ? new Date('2026-11-08T12:00:00Z') : null,
      };
    });
  await prisma.invitation.createMany({ skipDuplicates: true, data: invData });

  // Tasks ---------------------------------------------------------------------------------------
  const items = await prisma.checklistTemplateItem.findMany({
    where: { template: { name: 'Short engagement (3 months)' } },
    select: { id: true, sortOrder: true },
  });
  const itemId = new Map(items.map((i) => [i.sortOrder, i.id]));
  const taskRows = (weddingId: string, prefix: string, list: T[]) =>
    list.map(([title, status, priority, due, w, notes, tpl], i) => ({
      id: uid(prefix, i + 1),
      weddingId,
      title,
      status,
      priority,
      dueDate: dueOf(due),
      assigneeId: who(w),
      progressNotes: notes ?? null,
      completedAt: status === 'COMPLETED' ? dueOf(due) : null,
      sourceTemplateItemId: tpl ? (itemId.get(tpl) ?? null) : null,
    }));
  await prisma.task.createMany({
    skipDuplicates: true,
    data: [
      ...taskRows(ctx.wedding1Id, '9b000001', W1_TASKS),
      ...taskRows(ctx.wedding2Id, '9b000002', W2_TASKS),
      ...taskRows(ctx.wedding3Id, '9b000003', W3_TASKS),
      ...taskRows(ctx.wedding4Id, '9b000004', W4_TASKS),
    ],
  });

  // Expenses and payments -----------------------------------------------------------------------
  const expenseData: Prisma.ExpenseCreateManyInput[] = [];
  const paymentData: { id: string; expenseId: string; amount: string; paymentDate: Date; notes: string | null }[] = [];
  const plan: [string, string, string, E[]][] = [
    [ctx.wedding1Id, '9c000001', '9d000001', W1_EXPENSES],
    [ctx.wedding2Id, '9c000002', '9d000002', W2_EXPENSES],
    [ctx.wedding3Id, '9c000003', '9d000003', W3_EXPENSES],
    [ctx.wedding4Id, '9c000004', '9d000004', W4_EXPENSES],
  ];
  for (const [weddingId, ep, pp, list] of plan) {
    let payN = 0;
    list.forEach(([category, description, agreed, due, notes, pays], i) => {
      const id = uid(ep, i + 1);
      expenseData.push({ id, weddingId, category, description, agreedAmount: agreed, dueDate: dueOf(due), notes: notes ?? null });
      for (const [amount, date, pnotes] of pays) {
        payN += 1;
        paymentData.push({ id: uid(pp, payN), expenseId: id, amount, paymentDate: dateOnly(date), notes: pnotes ?? null });
      }
    });
  }
  await prisma.expense.createMany({ skipDuplicates: true, data: expenseData });
  await prisma.payment.createMany({ skipDuplicates: true, data: paymentData });

  // Suppliers and schedule ----------------------------------------------------------------------
  const supplierRows = (weddingId: string, prefix: string, list: S[]) =>
    list.map(([name, category, contactInfo, quotedPrice, notes], i) => ({ id: uid(prefix, i + 1), weddingId, name, category, contactInfo, quotedPrice, notes }));
  await prisma.supplier.createMany({
    skipDuplicates: true,
    data: [
      ...supplierRows(ctx.wedding1Id, '9e000001', W1_SUPPLIERS),
      ...supplierRows(ctx.wedding2Id, '9e000002', W2_SUPPLIERS),
      ...supplierRows(ctx.wedding3Id, '9e000003', W3_SUPPLIERS),
      ...supplierRows(ctx.wedding4Id, '9e000004', W4_SUPPLIERS),
    ],
  });
  const scheduleRows = (weddingId: string, prefix: string, list: Sch[]) =>
    list.map(([title, start, end, location, notes], i) => ({
      id: uid(prefix, i + 1), weddingId, title, startTime: new Date(start), endTime: new Date(end), location, notes,
    }));
  await prisma.scheduleItem.createMany({
    skipDuplicates: true,
    data: [...scheduleRows(ctx.wedding1Id, '9f000001', W1_SCHEDULE), ...scheduleRows(ctx.wedding2Id, '9f000002', W2_SCHEDULE)],
  });

  const base = process.env.APP_BASE_URL ?? 'http://localhost:4200';
  const rsvpUrls = isProd
    ? []
    : [
        { label: 'Open RSVP (Rita Demo-Guest, Emma & Daniel, can still answer)', url: `${base}/rsvp/${DEMO_OPEN_TOKEN}` },
        { label: 'Archived wedding (Hunor Bende, Lili & Bence, shows "no longer valid")', url: `${base}/rsvp/${DEMO_ARCHIVED_TOKEN}` },
      ];
  return { rsvpUrls };
}
