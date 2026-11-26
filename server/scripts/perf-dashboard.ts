/**
 * NFR-20 benchmark: dashboard + report latency on a representative dataset.
 *
 *   npm run perf:dashboard
 *
 * Uses a SEPARATE database whose name ends in `_perf` (derived from DATABASE_URL by swapping the
 * database name), applies the migrations, TRUNCATES it, seeds it with createMany and writes
 * docs/PERFORMANCE.md. It refuses to touch any other database.
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverDir, '..');

// ---- 1. Environment: must happen BEFORE the app (and Prisma) are imported ----------------------
dotenv.config({ path: path.join(serverDir, '.env'), quiet: true });
const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL is not set (server/.env).');
const url = new URL(baseUrl);
const baseName = url.pathname.replace(/^\//, '');
if (!baseName.endsWith('_perf')) url.pathname = `/${baseName.replace(/_test$/, '')}_perf`;
const perfName = url.pathname.replace(/^\//, '');
if (!perfName.endsWith('_perf')) throw new Error(`Refusing to run: database "${perfName}" does not end in _perf.`);
process.env.DATABASE_URL = url.toString();
process.env.LOG_LEVEL = 'silent';
process.env.CRON_ENABLED = 'false';

// ---- 2. Dataset shape --------------------------------------------------------------------------
const PLANNERS = 5;
const WEDDINGS = 5; // one per planner
const GUESTS = 200;
const TASKS = 100;
const EXPENSES = 40;
const PAYMENTS = 120;
const SUPPLIERS = 20;
const SCHEDULE = 30;
const MEMBERS_PER_WEDDING = 2;
const WARMUP = 10;
const SAMPLES = 50;
const TARGET_MS = 2000;

const day = 86_400_000;
const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length]!;

async function main() {
  console.log(`Perf database: ${perfName}`);
  execSync('npx prisma migrate deploy', { cwd: serverDir, stdio: 'pipe', env: process.env });

  const { prisma } = await import('../src/lib/prisma.js');
  const { createApp } = await import('../src/app.js');

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );

  // ---- 3. Seed (createMany, fixed pseudo-random pattern so runs are comparable) ----------------
  const password = 'PerfPassword123!';
  const passwordHash = await bcrypt.hash(password, 4);
  const planners = Array.from({ length: PLANNERS }, (_, i) => ({ id: randomUUID(), name: `Planner ${i + 1}`, email: `planner${i + 1}@perf.local`, passwordHash }));
  const memberUsers = Array.from({ length: WEDDINGS * MEMBERS_PER_WEDDING }, (_, i) => ({ id: randomUUID(), name: `Member ${i + 1}`, email: `member${i + 1}@perf.local`, passwordHash }));
  await prisma.user.createMany({ data: [...planners, ...memberUsers] });

  const now = Date.now();
  const weddingIds: string[] = [];
  for (let w = 0; w < WEDDINGS; w++) {
    const owner = planners[w]!;
    const members = memberUsers.slice(w * MEMBERS_PER_WEDDING, (w + 1) * MEMBERS_PER_WEDDING);
    const weddingId = randomUUID();
    weddingIds.push(weddingId);
    const weddingDate = new Date(now + 120 * day);
    await prisma.wedding.create({
      data: {
        id: weddingId,
        ownerId: owner.id,
        coupleNames: `Couple ${w + 1}`,
        weddingDate,
        location: 'Budapest',
        totalBudget: '60000.00',
        rsvpDeadline: new Date(now + 60 * day),
      },
    });
    await prisma.weddingMember.createMany({ data: members.map((m) => ({ weddingId, userId: m.id })) });

    // Guests: RSVP 50% pending / 30% accepted / 20% declined; every fifth has dietary requirements.
    const rsvp = ['PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'DECLINED', 'DECLINED'] as const;
    const diets = ['Vegetarian', 'Vegan', 'Gluten-free', 'Lactose intolerant', 'Nut allergy'];
    const guests = Array.from({ length: GUESTS }, (_, i) => ({
      id: randomUUID(),
      weddingId,
      name: `Guest ${w + 1}-${String(i + 1).padStart(3, '0')}`,
      email: `guest${w + 1}-${i + 1}@perf.local`,
      rsvpStatus: pick(rsvp, i),
      dietaryRequirements: i % 5 === 0 ? pick(diets, i / 5) : null,
      respondedAt: pick(rsvp, i) === 'PENDING' ? null : new Date(now - (i % 20) * day),
    }));
    await prisma.guest.createMany({ data: guests });

    // Invitations in mixed states: none (every 5th guest), SENT, FAILED, PENDING, revoked.
    const invitations = guests.flatMap((g, i) => {
      if (i % 5 === 4) return [];
      const state = i % 5; // 0..3
      return [
        {
          guestId: g.id,
          tokenHash: `perf-${w}-${i}-${randomUUID()}`,
          deliveryStatus: state === 2 ? ('FAILED' as const) : state === 3 ? ('PENDING' as const) : ('SENT' as const),
          attemptCount: state === 2 ? 3 : 1,
          lastSentAt: state === 3 ? null : new Date(now - day),
          lastError: state === 2 ? 'The email server could not be reached.' : null,
          revokedAt: i % 25 === 1 ? new Date(now - day) : null,
        },
      ];
    });
    await prisma.invitation.createMany({ data: invitations });

    // Tasks: mixed status, priority, assignee (owner / members / nobody), past and future deadlines.
    const statuses = ['TODO', 'IN_PROGRESS', 'COMPLETED'] as const;
    const priorities = ['LOW', 'MEDIUM', 'HIGH'] as const;
    const assignees = [owner.id, members[0]!.id, members[1]!.id, null];
    await prisma.task.createMany({
      data: Array.from({ length: TASKS }, (_, i) => ({
        weddingId,
        title: `Task ${i + 1}`,
        description: i % 3 === 0 ? 'Details for the task' : null,
        dueDate: new Date(now + (i - 30) * 2 * day),
        priority: pick(priorities, i),
        status: pick(statuses, i),
        assigneeId: pick(assignees, i),
        completedAt: pick(statuses, i) === 'COMPLETED' ? new Date(now - day) : null,
      })),
    });

    // Expenses with ~3 payments each (sum stays below the agreed amount).
    const categories = ['Venue', 'Catering', 'Music', 'Flowers', 'Photography', 'Attire', 'Decor', 'Transport'];
    const expenses = Array.from({ length: EXPENSES }, (_, i) => ({
      id: randomUUID(),
      weddingId,
      description: `Expense ${i + 1}`,
      category: pick(categories, i),
      agreedAmount: (1000 + (i % 7) * 500).toFixed(2),
      dueDate: new Date(now + (i - 15) * 5 * day),
    }));
    await prisma.expense.createMany({ data: expenses });
    await prisma.payment.createMany({
      data: Array.from({ length: PAYMENTS }, (_, i) => ({
        expenseId: expenses[i % EXPENSES]!.id,
        amount: (100 + (i % 3) * 100).toFixed(2), // max 3 payments x 300 = 900 < 1000
        paymentDate: new Date(now - (i % 60) * day),
      })),
    });

    await prisma.supplier.createMany({
      data: Array.from({ length: SUPPLIERS }, (_, i) => ({
        weddingId,
        name: `Supplier ${i + 1}`,
        category: pick(categories, i),
        contactInfo: `+36 1 555 ${String(1000 + i)}`,
        quotedPrice: i % 4 === 0 ? null : (500 + i * 120).toFixed(2),
      })),
    });

    // Schedule: 30 items on the wedding day; every 4th overlaps the previous one.
    const base = new Date(weddingDate);
    base.setUTCHours(8, 0, 0, 0);
    await prisma.scheduleItem.createMany({
      data: Array.from({ length: SCHEDULE }, (_, i) => {
        const start = new Date(base.getTime() + i * 30 * 60_000);
        return { weddingId, title: `Item ${i + 1}`, startTime: start, endTime: new Date(start.getTime() + (i % 4 === 3 ? 60 : 30) * 60_000), location: i % 2 ? 'Main hall' : null };
      }),
    });
  }

  // ---- 4. Machine / database info and dataset counts -------------------------------------------
  const pgVersion = (await prisma.$queryRaw<{ version: string }[]>`select version()`)[0]!.version;
  const counts = {
    users: await prisma.user.count(),
    weddings: await prisma.wedding.count(),
    members: await prisma.weddingMember.count(),
    guests: await prisma.guest.count(),
    invitations: await prisma.invitation.count(),
    tasks: await prisma.task.count(),
    expenses: await prisma.expense.count(),
    payments: await prisma.payment.count(),
    suppliers: await prisma.supplier.count(),
    scheduleItems: await prisma.scheduleItem.count(),
  };
  const cpus = os.cpus();
  const machine = {
    os: `${os.type()} ${os.release()} (${os.platform()} ${os.arch()})`,
    cpu: `${cpus[0]?.model.trim() ?? 'unknown'}, ${cpus.length} logical cores`,
    ram: `${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`,
    node: process.version,
    postgres: pgVersion.split(' on ')[0]!,
  };

  // ---- 5. Run the app on an ephemeral port and measure ----------------------------------------
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;

  const endpoints = [
    { name: 'GET /dashboard', path: (id: string) => `/api/weddings/${id}/dashboard` },
    { name: 'GET /reports/guests', path: (id: string) => `/api/weddings/${id}/reports/guests` },
    { name: 'GET /reports/budget', path: (id: string) => `/api/weddings/${id}/reports/budget` },
  ];
  const samples = new Map<string, number[]>(endpoints.map((e) => [e.name, []]));
  const perWedding = new Map<string, number[]>();

  try {
    for (let w = 0; w < WEDDINGS; w++) {
      const login = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: planners[w]!.email, password }),
      });
      if (login.status !== 200) throw new Error(`login failed (${login.status})`);
      const cookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0]!;
      const get = async (p: string) => {
        const t0 = performance.now();
        const res = await fetch(`${origin}${p}`, { headers: { cookie } });
        await res.arrayBuffer();
        const ms = performance.now() - t0;
        if (res.status !== 200) throw new Error(`${p} -> ${res.status}`);
        return ms;
      };
      for (const e of endpoints) {
        for (let i = 0; i < WARMUP; i++) await get(e.path(weddingIds[w]!));
        for (let i = 0; i < SAMPLES; i++) {
          const ms = await get(e.path(weddingIds[w]!));
          samples.get(e.name)!.push(ms);
          if (e.name === 'GET /dashboard') {
            const list = perWedding.get(String(w + 1)) ?? [];
            list.push(ms);
            perWedding.set(String(w + 1), list);
          }
        }
      }
      console.log(`wedding ${w + 1}/${WEDDINGS} measured`);
    }
  } finally {
    await new Promise((r) => server.close(r));
    await prisma.$disconnect();
  }

  // ---- 6. Report -------------------------------------------------------------------------------
  const stats = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
    return { n: s.length, min: s[0]!, median: q(0.5), p95: q(0.95), max: s[s.length - 1]! };
  };
  const f = (n: number) => n.toFixed(1);
  const rows = endpoints.map((e) => ({ name: e.name, ...stats(samples.get(e.name)!) }));
  const weddingRows = [...perWedding.entries()].map(([k, v]) => ({ name: `Wedding ${k}`, ...stats(v) }));
  const table = (rs: typeof rows) =>
    ['| Endpoint | Samples | Min (ms) | Median (ms) | p95 (ms) | Max (ms) |', '|---|---:|---:|---:|---:|---:|', ...rs.map((r) => `| ${r.name} | ${r.n} | ${f(r.min)} | ${f(r.median)} | ${f(r.p95)} | ${f(r.max)} |`)].join('\n');
  const dash = rows[0]!;
  const worst = Math.max(...rows.map((r) => r.max));
  const meets = dash.p95 < TARGET_MS && dash.max < TARGET_MS;

  const doc = `# Performance: dashboard load time (NFR-20)

NFR-20 (proposed target): the main dashboard loads within **2 s** on a documented test configuration
and a representative dataset. This document is that documentation. It is generated by
\`cd server && npm run perf:dashboard\` (script: \`server/scripts/perf-dashboard.ts\`); re-run it to refresh the numbers.

Last run: ${new Date().toISOString()}

## Test configuration

| Item | Value |
|---|---|
| Operating system | ${machine.os} |
| CPU | ${machine.cpu} |
| RAM | ${machine.ram} |
| Node.js | ${machine.node} |
| PostgreSQL | ${machine.postgres} (Docker container, \`docker-compose.yml\`, same machine) |
| Database | dedicated \`${perfName}\` (separate from the dev and test databases, truncated on every run) |
| Application | the real Express app (\`createApp()\`), real JWT cookie authentication, \`LOG_LEVEL=silent\`, cron off |
| Client | Node \`fetch\` on the same machine, loopback, one request at a time |

## Dataset

${PLANNERS} planners, each owning one wedding (${WEDDINGS} weddings), ${MEMBERS_PER_WEDDING} active team members per wedding. Per wedding:
${GUESTS} guests (50% pending, 30% accepted, 20% declined; every 5th with dietary requirements), invitations for 80% of the guests in
mixed states (sent, failed, pending, some revoked), ${TASKS} tasks (mixed status, priority, assignee, past and future deadlines),
${EXPENSES} expenses with ${PAYMENTS} payments, ${SUPPLIERS} suppliers, ${SCHEDULE} schedule items (some overlapping).

Totals in the database: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.

## Method

1. Apply migrations to \`${perfName}\`, truncate all tables, seed with \`createMany\`.
2. Start the app on an ephemeral port and log in as each planner (bcrypt cost of the seeded hashes is 4; login is not measured).
3. For each wedding and each endpoint: ${WARMUP} warm-up requests (discarded), then ${SAMPLES} measured sequential requests, i.e. ${SAMPLES * WEDDINGS} samples per endpoint.
   Time = from sending the request until the whole response body is read.
4. Report min / median / p95 / max. Every response is checked to be HTTP 200.

## Results

${table(rows)}

Dashboard per wedding:

${table(weddingRows)}

## Conclusion

${meets ? `**Target met.** The dashboard answers in a median of ${f(dash.median)} ms, p95 ${f(dash.p95)} ms and at worst ${f(dash.max)} ms, against the 2000 ms target (p95 is ${(TARGET_MS / dash.p95).toFixed(0)}x below it). The slowest request of all three endpoints was ${f(worst)} ms.` : `**Target NOT met.** Dashboard p95 ${f(dash.p95)} ms, max ${f(dash.max)} ms against the 2000 ms target. Investigate the queries.`}
The dashboard is computed on every request from stored rows (aggregates and group-bys, no stored totals, FR-59), so these numbers include
all of that work. They measure the backend only (network and Angular rendering are not included) on a single local machine with an
empty cache of other load; a hosted environment will differ, but the margin is large.
`;
  fs.writeFileSync(path.join(repoRoot, 'docs', 'PERFORMANCE.md'), doc);
  console.log(table(rows));
  console.log(JSON.stringify(machine));
  console.log('Wrote docs/PERFORMANCE.md');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
