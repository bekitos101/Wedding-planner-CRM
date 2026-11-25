import { Router } from 'express';
import { z } from 'zod';
import { currentUserId, requireAuth } from '../middleware/auth.js';
import { validate } from '../lib/validate.js';
import { userService } from '../services/userService.js';
import { emailSchema, nameSchema, newPasswordSchema } from './auth.js';
import { AUTH_COOKIE, authCookieOptions } from './cookies.js';

const patchBody = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    password: newPasswordSchema.optional(),
    currentPassword: z.string().max(1000).optional(),
  })
  .refine((b) => b.name !== undefined || b.email !== undefined || b.password !== undefined, {
    message: 'Provide at least one of name, email or password',
  });

export const meRouter = Router();

meRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json(await userService.getMe(currentUserId(req)));
  } catch (err) {
    next(err);
  }
});

meRouter.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { body } = validate(req, { body: patchBody });
    const { user, token } = await userService.updateMe(currentUserId(req), body);
    if (token) res.cookie(AUTH_COOKIE, token, authCookieOptions);
    res.json(user);
  } catch (err) {
    next(err);
  }
});
