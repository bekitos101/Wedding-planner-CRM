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

/** Loads server/.env.test, overriding anything already set (tests must never touch the dev DB). */
export function loadTestEnv() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.test');
  if (!fs.existsSync(file)) {
    throw new Error('server/.env.test is missing. Create it with: cp .env.test.example .env.test');
  }
  dotenv.config({ path: file, override: true, quiet: true });
  process.env.NODE_ENV = 'test';
  assertTestDatabase();
}
