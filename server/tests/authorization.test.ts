import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Router } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { weddingScoped } from '../src/routes/weddingScoped.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser, createWedding } from './helpers/factories.js';
import { BUDGET_ROUTES } from './routeSpecs/budget.js';
import { DASHBOARD_ROUTES } from './routeSpecs/dashboard.js';
import { GUEST_ROUTES } from './routeSpecs/guests.js';
import { PLANNING_ROUTES } from './routeSpecs/planning.js';
import { TASK_ROUTES } from './routeSpecs/tasks.js';
import type { Ctx, RouteSpec } from './routeSpecs/types.js';

beforeAll(resetDb);
afterAll(disconnectDb);

/** Phase 2 routes. Phase 3 tracks add theirs in tests/routeSpecs/<track>.ts (not here). */
const PHASE2_ROUTES: RouteSpec[] = [
  { name: 'GET wedding', method: 'get', pattern: '/weddings/:weddingId', path: (c) => `/api/weddings/${c.weddingId}`, access: 'member', write: false },
  { name: 'PATCH wedding', method: 'patch', pattern: '/weddings/:weddingId', path: (c) => `/api/weddings/${c.weddingId}`, body: { location: 'X' }, access: 'owner', write: true },
  // Archiving is idempotent: on an archived wedding it answers 200 and changes nothing.
  { name: 'POST archive', method: 'post', pattern: '/weddings/:weddingId/archive', path: (c) => `/api/weddings/${c.weddingId}/archive`, access: 'owner', write: true, archivedStatus: 200 },
  { name: 'GET members', method: 'get', pattern: '/weddings/:weddingId/members', path: (c) => `/api/weddings/${c.weddingId}/members`, access: 'owner', write: false },
  { name: 'POST members', method: 'post', pattern: '/weddings/:weddingId/members', path: (c) => `/api/weddings/${c.weddingId}/members`, body: { email: 'x@test.local' }, access: 'owner', write: true },
  // Revoking is allowed on archived weddings (removing access is a security action): 204.
  { name: 'DELETE member', method: 'delete', pattern: '/weddings/:weddingId/members/:userId', path: (c) => `/api/weddings/${c.weddingId}/members/${c.userId}`, access: 'owner', write: true, archivedStatus: 204 },
];

/** Every /weddings/:weddingId/... route (the enumeration test fails if a mounted route is missing). */
const WEDDING_ROUTES: RouteSpec[] = [...PHASE2_ROUTES, ...GUEST_ROUTES, ...TASK_ROUTES, ...BUDGET_ROUTES, ...PLANNING_ROUTES, ...DASHBOARD_ROUTES];

const call = (r: RouteSpec, c: Ctx, userId?: string) => {
  let req = api()[r.method](r.path(c));
  if (userId) req = req.set(bearer(userId));
  return r.body ? req.send(r.body) : req;
};

describe('wedding authorization (BR-14, FR-18, NFR-02)', () => {
  let owner: { id: string };
  let member: { id: string };
  let outsider: { id: string };
  let revoked: { id: string };
  let weddingId: string;

  beforeAll(async () => {
    owner = (await createUser()).user;
    member = (await createUser()).user;
    outsider = (await createUser()).user;
    revoked = (await createUser()).user;
    weddingId = (await createWedding(owner.id)).id;
    await prisma.weddingMember.create({ data: { weddingId, userId: member.id } });
    await prisma.weddingMember.create({ data: { weddingId, userId: revoked.id, status: 'REVOKED', revokedAt: new Date() } });
  });

  it('BR-14: non-member gets 404 on every wedding route (identical body for all cases)', async () => {
    const ghost = '11111111-1111-4111-8111-111111111111';
    const cases = [
      { label: 'outsider', weddingId, userId: outsider.id },
      { label: 'revoked member', weddingId, userId: revoked.id },
      { label: 'random uuid', weddingId: ghost, userId: owner.id },
      { label: 'malformed id', weddingId: 'not-a-uuid', userId: owner.id },
    ];
    let reference: unknown;
    for (const route of WEDDING_ROUTES) {
      for (const c of cases) {
        const res = await call(route, { weddingId: c.weddingId, userId: member.id }, c.userId);
        expect(res.status, `${route.name} / ${c.label}`).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
        reference ??= res.body;
        expect(res.body, `${route.name} / ${c.label}`).toEqual(reference);
      }
    }
    expect((reference as { error: { message: string } }).error.message).toBe('Wedding not found.');
  }, 120_000); // every route × 4 callers: allow time on a busy machine

  it('BR-14: the rejected requests changed nothing', async () => {
    const w = await prisma.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    expect(w).toMatchObject({ location: 'Budapest', status: 'ACTIVE' });
    expect(await prisma.weddingMember.count({ where: { weddingId } })).toBe(2);
  });

  it('FR-18: team member gets 403 on owner-only routes via direct API', async () => {
    const ownerOnly = WEDDING_ROUTES.filter((r) => r.access === 'owner');
    expect(ownerOnly.length).toBeGreaterThan(0);
    for (const route of ownerOnly) {
      const res = await call(route, { weddingId, userId: member.id }, member.id);
      expect(res.status, route.name).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await prisma.weddingMember.count({ where: { weddingId, status: 'ACTIVE' } })).toBe(1);
    expect((await prisma.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe('ACTIVE');
  });

  it('FR-14: team member can use read routes', async () => {
    // Read routes only: member-accessible WRITE routes (e.g. PATCH task) are decided by their service.
    for (const route of WEDDING_ROUTES.filter((r) => r.access === 'member' && !r.write)) {
      const res = await call(route, { weddingId, userId: member.id }, member.id);
      expect(res.status, route.name).toBe(route.memberReadStatus ?? 200);
      // Never a permission error: a 404 here must be "child not found", not "wedding not found".
      if (res.status === 404) expect(res.body.error.message, route.name).not.toBe('Wedding not found.');
    }
  });

  it('NFR-02: unauthenticated → 401 on all of them', async () => {
    for (const route of WEDDING_ROUTES) {
      const res = await call(route, { weddingId, userId: member.id });
      expect(res.status, route.name).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect((await api().get('/api/weddings')).status).toBe(401);
    expect((await api().post('/api/weddings')).status).toBe(401);
  });

  it('NFR-02: an invalid token → 401 even with a valid wedding id', async () => {
    const res = await api().get(`/api/weddings/${weddingId}`).set({ Authorization: 'Bearer garbage' });
    expect(res.status).toBe(401);
  });

  it('BR-13: on an archived wedding every write route answers 409 (except the documented ones) and the DB is unchanged', async () => {
    const { user: o } = await createUser();
    const { user: m } = await createUser();
    const archivedId = (await createWedding(o.id)).id;
    await prisma.weddingMember.create({ data: { weddingId: archivedId, userId: m.id } });
    expect((await api().post(`/api/weddings/${archivedId}/archive`).set(bearer(o.id))).status).toBe(200);
    const snapshot = async () => ({
      wedding: await prisma.wedding.findUniqueOrThrow({ where: { id: archivedId } }),
      members: await prisma.weddingMember.findMany({ where: { weddingId: archivedId }, orderBy: { id: 'asc' } }),
      users: await prisma.user.count(),
    });
    const ctx = { weddingId: archivedId, userId: m.id };
    const before = await snapshot();
    const revoke = WEDDING_ROUTES.find((r) => r.method === 'delete' && r.pattern.endsWith('/members/:userId'));
    for (const route of WEDDING_ROUTES.filter((r) => r !== revoke)) {
      const res = await call(route, ctx, o.id);
      const expected = route.archivedStatus ?? (route.write ? 409 : 200);
      expect(res.status, route.name).toBe(expected);
      if (expected === 409) expect(res.body.error.message).toBe("This wedding is archived and can't be changed.");
    }
    expect(await snapshot()).toEqual(before);
    // Revoke is the one allowed change: access removed, nothing deleted.
    expect(revoke).toBeDefined();
    expect((await call(revoke!, ctx, o.id)).status).toBe(revoke!.archivedStatus);
    const after = await snapshot();
    expect(after.wedding).toEqual(before.wedding);
    expect(after.members).toHaveLength(1);
    expect(after.members[0]!.status).toBe('REVOKED');
  }, 120_000); // every route on an archived wedding: allow time on a busy machine

  it('FR-18: every route under /weddings/:weddingId is listed in WEDDING_ROUTES and sits behind weddingScoped', () => {
    interface Layer {
      rawPath?: unknown;
      route?: { path: string; methods: Record<string, boolean> };
      handle: { stack?: Layer[] };
    }
    const found: { key: string; scoped: boolean }[] = [];
    const walk = (stack: Layer[], prefix: string, scoped: boolean) => {
      for (const layer of stack) {
        const raw = typeof layer.rawPath === 'string' && layer.rawPath !== '/' ? layer.rawPath : '';
        if (layer.route) {
          const full = (prefix + (layer.route.path === '/' ? '' : layer.route.path)).replace(/\/$/, '') || '/';
          for (const m of Object.keys(layer.route.methods)) found.push({ key: `${m.toUpperCase()} ${full}`, scoped });
        } else if (layer.handle.stack) {
          walk(layer.handle.stack, prefix + raw, scoped || (layer.handle as unknown) === (weddingScoped as unknown as Router));
        }
      }
    };
    const app = createApp() as unknown as { router: { stack: Layer[] } };
    walk(app.router.stack, '', false);
    const wedding = found.filter((f) => f.key.split(' ')[1]!.startsWith('/api/weddings/:weddingId'));
    expect(wedding.length).toBeGreaterThan(0);
    // Structural guard: nothing under /weddings/:weddingId may bypass the scoped router.
    expect(wedding.filter((f) => !f.scoped).map((f) => f.key)).toEqual([]);
    // Every real route is in the table...
    const listed = new Set(WEDDING_ROUTES.map((r) => `${r.method.toUpperCase()} /api${r.pattern}`));
    expect(wedding.map((f) => f.key).filter((k) => !listed.has(k))).toEqual([]);
    // ...and the table has no stale entries.
    const real = new Set(wedding.map((f) => f.key));
    expect([...listed].filter((k) => !real.has(k))).toEqual([]);
  });
});
