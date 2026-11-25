import { PrismaClient } from '@prisma/client';

// Single client. Only repositories may import this module.
export const prisma = new PrismaClient();
