import type { PrismaClient } from '@prisma/client';

/** What every track seed receives. All seeds must be idempotent (fixed ids + upserts). */
export interface SeedContext {
  prisma: PrismaClient;
  ownerId: string; // owner@demo.test (Olivia Owner)
  memberId: string; // member@demo.test (Tom Teammate) — ACTIVE member of wedding 1 only
  wedding1Id: string; // Emma & Daniel (owner: Olivia, member: Tom)
  wedding2Id: string; // Sofia & Marco (owner: Olivia, member: Anna)
  assistantId: string; // assistant@demo.test (Anna Assistant) - ACTIVE member of weddings 1 and 2
  formerId: string; // former@demo.test (Mark Former) - REVOKED member of wedding 1
  planner2Id: string; // planner2@demo.test (Peter Planner) - owns wedding 4 only
  wedding3Id: string; // Lili & Bence (owner: Olivia, ARCHIVED)
  wedding4Id: string; // Eger wedding (owner: Peter Planner)
}
