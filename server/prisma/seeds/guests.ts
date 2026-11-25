import type { SeedContext } from './context.js';

const GUESTS: { n: number; name: string; email: string; rsvpStatus: 'PENDING' | 'ACCEPTED' | 'DECLINED'; dietary?: string }[] = [
  { n: 1, name: 'Anna Kovacs', email: 'anna.kovacs@example.com', rsvpStatus: 'ACCEPTED' },
  { n: 2, name: 'Bela Szabo', email: 'bela.szabo@example.com', rsvpStatus: 'ACCEPTED', dietary: 'Vegetarian' },
  { n: 3, name: 'Csilla Nagy', email: 'csilla.nagy@example.com', rsvpStatus: 'DECLINED' },
  { n: 4, name: 'David Toth', email: 'david.toth@example.com', rsvpStatus: 'PENDING' },
  { n: 5, name: 'Eszter Horvath', email: 'eszter.horvath@example.com', rsvpStatus: 'ACCEPTED', dietary: 'Gluten free' },
  { n: 6, name: 'Ferenc Varga', email: 'ferenc.varga@example.com', rsvpStatus: 'PENDING' },
  { n: 7, name: 'Greta Molnar', email: 'greta.molnar@example.com', rsvpStatus: 'PENDING' },
  { n: 8, name: 'Hanna Farkas', email: 'hanna.farkas@example.com', rsvpStatus: 'DECLINED' },
  { n: 9, name: 'Istvan Balogh', email: 'istvan.balogh@example.com', rsvpStatus: 'ACCEPTED' },
  { n: 10, name: 'Judit Papp', email: 'judit.papp@example.com', rsvpStatus: 'PENDING' },
];

const guestId = (n: number) => `00000000-0000-4000-8a00-${String(n).padStart(12, '0')}`;

/** Track 3A guests demo data. Idempotent: fixed uuids and upserts; no invitations (tokens can't be shown). */
export async function seedGuests(ctx: SeedContext): Promise<void> {
  for (const g of GUESTS) {
    const data = {
      weddingId: ctx.wedding1Id,
      name: g.name,
      email: g.email,
      rsvpStatus: g.rsvpStatus,
      dietaryRequirements: g.dietary ?? null,
      respondedAt: g.rsvpStatus === 'PENDING' ? null : new Date('2026-11-01T10:00:00Z'),
    };
    await ctx.prisma.guest.upsert({ where: { id: guestId(g.n) }, create: { id: guestId(g.n), ...data }, update: data });
  }
}
