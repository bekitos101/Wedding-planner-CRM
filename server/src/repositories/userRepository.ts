import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export const userRepository = {
  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },
  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },
  create(data: { name: string; email: string; passwordHash: string }): Promise<User> {
    return prisma.user.create({ data });
  },
  update(id: string, data: { name?: string; email?: string; passwordHash?: string; passwordChangedAt?: Date }): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },
};
