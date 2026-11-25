import { prisma } from '../lib/prisma.js';

export const healthRepository = {
  async pingDb(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  },
};
