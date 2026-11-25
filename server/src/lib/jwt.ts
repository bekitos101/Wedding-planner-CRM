import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signToken(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, { algorithm: 'HS256', subject: userId, expiresIn: TOKEN_TTL_SECONDS });
}

/** Returns the user id and issue time (seconds), or null for any invalid/expired/foreign token. */
export function verifyToken(token: string): { userId: string; iat: number } | null {
  try {
    // maxAge rejects tokens that carry no iat or are older than the TTL.
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], maxAge: `${TOKEN_TTL_SECONDS}s` });
    if (typeof payload !== 'object' || typeof payload.sub !== 'string' || typeof payload.iat !== 'number') return null;
    if (typeof payload.exp !== 'number') return null;
    return { userId: payload.sub, iat: payload.iat };
  } catch {
    return null;
  }
}
