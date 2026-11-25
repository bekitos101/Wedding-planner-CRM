import { conflict, unauthenticated } from '../lib/errors.js';
import { signToken, verifyToken } from '../lib/jwt.js';
import { userRepository } from '../repositories/userRepository.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords.js';
import { toUserDto, type UserDto } from './userDto.js';

const normalizeEmail = (e: string) => e.trim().toLowerCase();

export const authService = {
  async register(input: { name: string; email: string; password: string }): Promise<{ user: UserDto; token: string }> {
    const email = normalizeEmail(input.email);
    if (await userRepository.findByEmail(email)) throw conflict('An account with this email already exists.');
    const passwordHash = await hashPassword(input.password);
    // A concurrent duplicate is mapped to 409 by the error handler (P2002).
    const user = await userRepository.create({ name: input.name.trim(), email, passwordHash });
    return { user: toUserDto(user), token: signToken(user.id) };
  },

  async login(input: { email: string; password: string }): Promise<{ user: UserDto; token: string }> {
    const user = await userRepository.findByEmail(normalizeEmail(input.email));
    if (!user) {
      await burnPasswordCheck(input.password);
      throw unauthenticated('Email or password is incorrect.');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw unauthenticated('Email or password is incorrect.');
    }
    return { user: toUserDto(user), token: signToken(user.id) };
  },

  /** Resolves a JWT to an existing user id; throws 401 otherwise. */
  async authenticate(token: string): Promise<{ id: string }> {
    const msg = 'Your session is invalid or has expired. Please log in again.';
    const claims = verifyToken(token);
    if (!claims) throw unauthenticated(msg);
    const user = await userRepository.findById(claims.userId);
    if (!user) throw unauthenticated(msg);
    // Password change ends older sessions; a token from the same second stays valid.
    if (user.passwordChangedAt && claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      throw unauthenticated(msg);
    }
    return { id: user.id };
  },
};
