import { prisma } from '../../src/lib/prisma.js';
import { assertTestDatabase } from '../loadTestEnv.js';

/** Truncates every table (except Prisma's migration bookkeeping). Call in beforeAll of each test file. */
export async function resetDb(): Promise<void> {
  assertTestDatabase();
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
