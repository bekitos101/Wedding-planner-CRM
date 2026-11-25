import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestDatabase, loadTestEnv } from './loadTestEnv.js';

export default function setup() {
  loadTestEnv();
  assertTestDatabase();
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execSync('npx prisma migrate deploy', { cwd, stdio: 'pipe', env: process.env });
}
