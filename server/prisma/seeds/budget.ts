import type { SeedContext } from './context.js';

/** Track 3C expenses and payments demo data. Idempotent: fixed uuids and upserts, so re-running never duplicates. */
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const id = (n: number, kind: 'e' | 'p') => `${kind === 'e' ? 'c3c3c3c3' : 'd3d3d3d3'}-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface SeedExpense {
  n: number;
  weddingKey: 'wedding1Id' | 'wedding2Id';
  description: string;
  category: string;
  agreedAmount: string;
  dueDate: string;
  notes?: string;
  payments: { n: number; amount: string; date: string; notes?: string }[];
}

const EXPENSES: SeedExpense[] = [
  { n: 1, weddingKey: 'wedding1Id', description: 'Lake Balaton Manor hire', category: 'Venue', agreedAmount: '8000.00', dueDate: '2027-05-19',
    payments: [{ n: 1, amount: '2000.00', date: '2026-09-01', notes: 'Deposit' }, { n: 2, amount: '3000.00', date: '2027-01-15', notes: 'Second instalment' }] },
  { n: 2, weddingKey: 'wedding1Id', description: 'Wedding dinner for 120 guests', category: 'Catering', agreedAmount: '9000.00', dueDate: '2027-06-10',
    payments: [{ n: 3, amount: '1500.00', date: '2026-10-05', notes: 'Booking deposit' }] },
  { n: 3, weddingKey: 'wedding1Id', description: 'Photographer and second shooter', category: 'Photography', agreedAmount: '2500.00', dueDate: '2026-10-31', notes: 'Final payment overdue',
    payments: [{ n: 4, amount: '1000.00', date: '2026-06-20', notes: 'Deposit' }] },
  { n: 4, weddingKey: 'wedding1Id', description: 'Bouquets and table flowers', category: 'Flowers', agreedAmount: '1200.00', dueDate: '2027-06-01',
    payments: [{ n: 5, amount: '1200.00', date: '2026-11-01', notes: 'Paid in full' }] },
  { n: 5, weddingKey: 'wedding1Id', description: 'Live band', category: 'Music', agreedAmount: '2200.00', dueDate: '2027-06-19', payments: [] },
  { n: 6, weddingKey: 'wedding1Id', description: 'Wedding dress and suit', category: 'Attire', agreedAmount: '3100.00', dueDate: '2027-04-30',
    payments: [{ n: 6, amount: '500.00', date: '2026-08-12', notes: 'Dress deposit' }, { n: 7, amount: '600.00', date: '2026-11-10' }] },
  { n: 7, weddingKey: 'wedding2Id', description: 'Riverside Hall hire', category: 'Venue', agreedAmount: '6500.00', dueDate: '2027-08-25',
    payments: [{ n: 8, amount: '1300.00', date: '2026-10-20', notes: 'Deposit' }] },
  { n: 8, weddingKey: 'wedding2Id', description: 'Photo booth', category: 'Photography', agreedAmount: '800.00', dueDate: '2027-09-01', payments: [] },
];

export async function seedBudget(ctx: SeedContext): Promise<void> {
  for (const e of EXPENSES) {
    const weddingId = ctx[e.weddingKey];
    const data = { weddingId, description: e.description, category: e.category, agreedAmount: e.agreedAmount, dueDate: d(e.dueDate), notes: e.notes ?? null };
    await ctx.prisma.expense.upsert({ where: { id: id(e.n, 'e') }, create: { id: id(e.n, 'e'), ...data }, update: data });
    for (const p of e.payments) {
      const pd = { expenseId: id(e.n, 'e'), amount: p.amount, paymentDate: d(p.date), notes: p.notes ?? null };
      await ctx.prisma.payment.upsert({ where: { id: id(p.n, 'p') }, create: { id: id(p.n, 'p'), ...pd }, update: pd });
    }
  }
}
