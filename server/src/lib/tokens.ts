import { createHash, randomBytes } from 'node:crypto';

/** New invitation token: 32 random bytes, base64url (43 chars). Never log it, never store it (NFR-03). */
export const generateToken = (): string => randomBytes(32).toString('base64url');

/** SHA-256 hex of a token: the only form that is stored. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Cheap shape check so obviously bogus tokens never reach the database. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const looksLikeToken = (token: string): boolean => TOKEN_RE.test(token);
