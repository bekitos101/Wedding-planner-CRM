import { signToken } from '../../src/lib/jwt.js';

/** Authorization header for a user id (tests only). */
export const bearer = (userId: string): Record<string, string> => ({ Authorization: `Bearer ${signToken(userId)}` });
