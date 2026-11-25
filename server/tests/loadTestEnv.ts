import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Throws unless the URL points at a database whose name ends in `_test`. */
export function assertTestDatabase(url: string | undefined = process.env.DATABASE_URL): void {
  let dbName = '';
  try {
    dbName = new URL(url ?? '').pathname.replace(/^\//, '');
  } catch {
    /* handled below */
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests: DATABASE_URL must point to a database whose name ends with "_test" (got "${dbName}").`);
  }
}

/**
 * Loads server/.env.test, overriding anything already set (tests must never touch the dev DB).
 *
 * Optional `TEST_DB_SUFFIX` (e.g. `a`) switches to a separate database `<name>_<suffix>_test`, so
 * several test runs can execute at the same time without truncating each other's data.
 * The databases must exist (docker: CREATE DATABASE wedding_organizer_a_test OWNER wedding;).
 */
export function loadTestEnv() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.test');
  if (!fs.existsSync(file)) {
    throw new Error('server/.env.test is missing. Create it with: cp .env.test.example .env.test');
  }
  const suffix = process.env.TEST_DB_SUFFIX; // read before .env.test overrides the environment
  dotenv.config({ path: file, override: true, quiet: true });
  process.env.NODE_ENV = 'test';
  if (suffix) {
    if (!/^[a-z0-9]{1,10}$/.test(suffix)) throw new Error('TEST_DB_SUFFIX must be 1-10 lowercase letters/digits.');
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.pathname = url.pathname.replace(/_test$/, `_${suffix}_test`);
    process.env.DATABASE_URL = url.toString();
  }
  assertTestDatabase();
}
