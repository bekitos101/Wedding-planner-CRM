import dotenv from 'dotenv';
import { z } from 'zod';

// Existing process env wins (tests preload .env.test in tests/setup.ts).
dotenv.config({ quiet: true });

const boolish = z.enum(['true', 'false']).default('true').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default('Wedding Organizer <no-reply@wedding.local>'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  CONTACT_TO: z.string().email().default('hello@wedding-organizer.local'),
  APP_BASE_URL: z.string().url().default('http://localhost:4200'),
  REMINDER_DAYS_BEFORE: z.coerce.number().int().min(0).default(3),
  CRON_ENABLED: boolish,
});

const PLACEHOLDER_SECRET = 'change-me-change-me-change-me-change-me';

const parsed = schema
  .refine((e) => !(e.NODE_ENV === 'production' && e.JWT_SECRET === PLACEHOLDER_SECRET), {
    path: ['JWT_SECRET'],
    message: 'JWT_SECRET must not be the placeholder from .env.example in production',
  })
  .safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${lines.join('\n')}\nSee server/.env.example.`);
  process.exit(1);
}

export const env = parsed.data;
