import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validate.js';
import { authService } from '../services/authService.js';
import { AUTH_COOKIE, authCookieOptions, clearCookieOptions } from './cookies.js';

export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address' }).max(254));
export const nameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters');
export const newPasswordSchema = z
  .string({ error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes');

const registerBody = z.object({ name: nameSchema, email: emailSchema, password: newPasswordSchema });
const loginBody = z.object({
  email: emailSchema,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(1000),
});

export const authRouter = Router();

authRouter.post('/auth/register', async (req, res, next) => {
  try {
    const { body } = validate(req, { body: registerBody });
    const { user, token } = await authService.register(body);
    res.cookie(AUTH_COOKIE, token, authCookieOptions).status(201).json(user);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/login', async (req, res, next) => {
  try {
    const { body } = validate(req, { body: loginBody });
    const { user, token } = await authService.login(body);
    res.cookie(AUTH_COOKIE, token, authCookieOptions).status(200).json(user);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, clearCookieOptions).status(204).end();
});
