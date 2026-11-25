import type { User } from '@prisma/client';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export const toUserDto = (u: User): UserDto => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt });
