import type { CookieOptions } from 'express';
import { env } from '../config/env.js';
import { TOKEN_TTL_SECONDS } from '../lib/jwt.js';

export const AUTH_COOKIE = 'token';

const base: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path: '/' };
export const authCookieOptions: CookieOptions = { ...base, maxAge: TOKEN_TTL_SECONDS * 1000 };
export const clearCookieOptions: CookieOptions = base;
