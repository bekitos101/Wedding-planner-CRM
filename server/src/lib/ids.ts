import { z } from 'zod';

// Any UUID-shaped string; Postgres' uuid type accepts every version/variant.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared zod schema for uuid route params (normalised to lower case). */
export const uuidParam = z
  .string()
  .regex(UUID_RE)
  .transform((s) => s.toLowerCase());

/** Parsed uuid, or null when malformed (callers answer with their own 404). */
export function parseUuidParam(v: unknown): string | null {
  const r = uuidParam.safeParse(v);
  return r.success ? r.data : null;
}
