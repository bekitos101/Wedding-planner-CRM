import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { parseDateOnly, toDateOnly } from './dates.js';

/**
 * Shared zod building blocks for request validation (NFR-04). Phase 3 tracks: import from here
 * instead of re-implementing date/money/text parsing, so every endpoint behaves the same way.
 */

/** Strict "YYYY-MM-DD" calendar date within 2000-01-01..2100-12-31 → Date (UTC midnight). */
export const dateOnly = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .refine((s) => parseDateOnly(s) !== null, `${label} must be a calendar date as YYYY-MM-DD between 2000-01-01 and 2100-12-31`)
    .transform((s) => parseDateOnly(s) as Date);

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Money: string or number, >= 0, at most 10 integer digits and 2 decimals → Prisma.Decimal.
 * Kept as a string until it becomes a Decimal, so no float arithmetic ever happens.
 * Use `.refine((d) => d.gt(0), ...)` on top for amounts that must be positive.
 */
export const money = (label: string) =>
  z
    .union([z.string(), z.number().finite()], { error: `${label} is required` })
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
    .refine((s) => MONEY_RE.test(s), `${label} must be 0 or more, with at most 10 digits and 2 decimals`)
    .transform((s) => new Prisma.Decimal(s));

/** Required trimmed text, 1..max characters. */
export const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

/** Optional trimmed text, 0..max characters; empty string or null → null. */
export const optionalText = (label: string, max: number) =>
  z
    .string({ error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullish()
    .transform((s) => (s ? s : null));

/** Email: trimmed, lowercased, max 254. */
export const email = (label = 'Email') =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .toLowerCase()
    .max(254, `${label} must be at most 254 characters`)
    .pipe(z.email(`Enter a valid email address`));

/** Response helpers: money as a 2-decimal string, dates as "YYYY-MM-DD". */
export const formatMoney = (d: Prisma.Decimal | null | undefined): string | null => (d == null ? null : d.toFixed(2));
export const formatDateOnly = (d: Date | null | undefined): string | null => (d == null ? null : toDateOnly(d));
