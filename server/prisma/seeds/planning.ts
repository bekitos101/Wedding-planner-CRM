import type { SeedContext } from './context.js';

/** Track 3D suppliers and schedule items demo data. Idempotent: fixed uuids + upserts, so re-running never duplicates. */

const id = (n: number) => `00000000-0000-4000-8000-0000000d${String(n).padStart(4, '0')}`;

interface SeedSupplier {
  id: string;
  weddingId: 1 | 2;
  name: string;
  category: string;
  contactInfo: string | null;
  quotedPrice: string | null;
  notes: string | null;
}

const SUPPLIERS: SeedSupplier[] = [
  { id: id(1), weddingId: 1, name: 'Lake Balaton Manor', category: 'Venue', contactInfo: 'events@balatonmanor.example, +36 1 555 0101', quotedPrice: '8500.00', notes: 'Includes ceremony garden and ballroom.' },
  { id: id(2), weddingId: 1, name: 'Gourmet Table Catering', category: 'Catering', contactInfo: 'hello@gourmettable.example', quotedPrice: '6200.00', notes: 'Tasting booked for March.' },
  { id: id(3), weddingId: 1, name: 'Lens & Light Studio', category: 'Photography', contactInfo: '+36 1 555 0103', quotedPrice: '2400.00', notes: null },
  { id: id(4), weddingId: 1, name: 'Wild Bloom Florals', category: 'Flowers', contactInfo: 'https://wildbloom.example', quotedPrice: '1300.00', notes: null },
  { id: id(5), weddingId: 1, name: 'The Midnight Band', category: 'Music', contactInfo: 'booking@midnightband.example', quotedPrice: null, notes: 'Waiting for a quote.' },
  { id: id(6), weddingId: 1, name: 'Sweet Layers Bakery', category: 'Cake', contactInfo: '+36 1 555 0106', quotedPrice: '480.00', notes: 'Three tiers, lemon and vanilla.' },
  { id: id(7), weddingId: 2, name: 'Danube Riverside Hall', category: 'Venue', contactInfo: 'info@riversidehall.example', quotedPrice: '7000.00', notes: null },
  { id: id(8), weddingId: 2, name: 'Rosa Photography', category: 'Photography', contactInfo: null, quotedPrice: null, notes: null },
];

// Wedding day 2027-06-19 in Europe/Budapest (CEST, UTC+2 in June): local time minus two hours = UTC.
const ITEMS = [
  { id: id(101), title: 'Getting ready', startTime: '2027-06-19T08:00:00Z', endTime: '2027-06-19T10:00:00Z', location: 'Bridal suite', notes: null }, // 10:00-12:00
  { id: id(102), title: 'Guest arrival', startTime: '2027-06-19T11:30:00Z', endTime: '2027-06-19T12:00:00Z', location: 'Manor garden', notes: null }, // 13:30-14:00
  { id: id(103), title: 'Ceremony', startTime: '2027-06-19T12:00:00Z', endTime: '2027-06-19T12:45:00Z', location: 'Manor garden', notes: null }, // 14:00-14:45
  { id: id(104), title: 'Cocktail hour', startTime: '2027-06-19T13:00:00Z', endTime: '2027-06-19T14:00:00Z', location: 'Terrace', notes: null }, // 15:00-16:00
  { id: id(105), title: 'Couple photos', startTime: '2027-06-19T13:30:00Z', endTime: '2027-06-19T14:30:00Z', location: 'Lakeside', notes: 'Intentional overlap with the cocktail hour.' }, // 15:30-16:30
  { id: id(106), title: 'Dinner', startTime: '2027-06-19T15:00:00Z', endTime: '2027-06-19T17:00:00Z', location: 'Ballroom', notes: null }, // 17:00-19:00
  { id: id(107), title: 'First dance', startTime: '2027-06-19T17:30:00Z', endTime: '2027-06-19T18:00:00Z', location: 'Ballroom', notes: 'Starts right after the cake cutting (back-to-back, no overlap).' }, // 19:30-20:00
];

export async function seedPlanning(ctx: SeedContext): Promise<void> {
  const weddingIds = { 1: ctx.wedding1Id, 2: ctx.wedding2Id };
  for (const s of SUPPLIERS) {
    const data = { name: s.name, category: s.category, contactInfo: s.contactInfo, quotedPrice: s.quotedPrice, notes: s.notes };
    await ctx.prisma.supplier.upsert({
      where: { id: s.id },
      update: data,
      create: { id: s.id, weddingId: weddingIds[s.weddingId], ...data },
    });
  }
  for (const i of ITEMS) {
    const data = { title: i.title, startTime: new Date(i.startTime), endTime: new Date(i.endTime), location: i.location, notes: i.notes };
    await ctx.prisma.scheduleItem.upsert({
      where: { id: i.id },
      update: data,
      create: { id: i.id, weddingId: ctx.wedding1Id, ...data },
    });
  }
}
