import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validate.js';
import { contactService } from '../services/contactService.js';

const noLineBreaks = (s: string) => s.replace(/[\r\n]+/g, ' ');

const contactBody = z.object({
  name: z.string().transform(noLineBreaks).pipe(z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters')),
  email: z.string().trim().max(254, 'Email must be at most 254 characters').pipe(z.email('Enter a valid email address')),
  subject: z
    .string()
    .transform(noLineBreaks)
    .pipe(z.string().trim().max(150, 'Subject must be at most 150 characters'))
    .optional(),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(5000, 'Message must be at most 5000 characters'),
  contact_hp: z.string().max(1000).optional(),
});

/** `limiter` is created per app instance in createApp() so tests are isolated. */
export function createContactRouter(limiter: RequestHandler): Router {
  const router = Router();
  router.post('/contact', limiter, async (req, res, next) => {
    try {
      const { body } = validate(req, { body: contactBody });
      res.status(202).json(await contactService.submit(body, req.log));
    } catch (err) {
      next(err);
    }
  });
  return router;
}
