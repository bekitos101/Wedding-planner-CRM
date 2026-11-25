import { AppError, conflict, unauthenticated, validationError } from '../lib/errors.js';
import { signToken } from '../lib/jwt.js';
import { userRepository } from '../repositories/userRepository.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { toUserDto, type UserDto } from './userDto.js';

export interface UpdateMeInput {
  name?: string;
  email?: string;
  password?: string;
  currentPassword?: string;
}

export const userService = {
  async getMe(userId: string): Promise<UserDto> {
    const user = await userRepository.findById(userId);
    if (!user) throw unauthenticated();
    return toUserDto(user);
  },

  async updateMe(userId: string, input: UpdateMeInput): Promise<{ user: UserDto; token?: string }> {
    const user = await userRepository.findById(userId);
    if (!user) throw unauthenticated();

    const email = input.email?.trim().toLowerCase();
    const emailChanges = email !== undefined && email !== user.email;
    const passwordChanges = input.password !== undefined;

    if (emailChanges || passwordChanges) {
      if (!input.currentPassword) {
        throw validationError('Please enter your current password to change your email or password.', {
          currentPassword: 'Required to change email or password',
        });
      }
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new AppError(403, 'FORBIDDEN', 'Current password is incorrect.', {
          currentPassword: 'Current password is incorrect',
        });
      }
    }

    if (emailChanges && (await userRepository.findByEmail(email))) {
      throw conflict('An account with this email already exists.');
    }

    const data: { name?: string; email?: string; passwordHash?: string; passwordChangedAt?: Date } = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (emailChanges) data.email = email;
    if (passwordChanges) {
      data.passwordHash = await hashPassword(input.password!);
      data.passwordChangedAt = new Date();
    }

    const updated = await userRepository.update(userId, data);
    // Re-issue a session token when the password changed so the caller stays logged in.
    return { user: toUserDto(updated), token: passwordChanges ? signToken(updated.id) : undefined };
  },
};
