import type { PrismaClient } from '@prisma/client';

/** What every track seed receives. All seeds must be idempotent (fixed ids + upserts). */
export interface SeedContext {
  prisma: PrismaClient;
  ownerId: string; // owner@demo.test (Olivia Owner)
  memberId: string; // member@demo.test (Tom Teammate) — ACTIVE member of wedding 1 only
  wedding1Id: string; // Emma & Daniel (owner: Olivia, member: Tom)
  wedding2Id: string; // Sofia & Marco (owner: Olivia, no members)
}
