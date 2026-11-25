import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { api } from './helpers/app.js';
import { createUser } from './helpers/factories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

const PASSWORD = 'Password123!';
const USER_KEYS = ['createdAt', 'email', 'id', 'name'];

function tokenOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'] as string[] | undefined;
  const c = raw?.find((x) => x.startsWith('token='));
  if (!c) throw new Error('no token cookie');
  return c.split(';')[0]!.slice('token='.length);
}

async function login(email: string) {
  const res = await api().post('/api/auth/login').send({ email, password: PASSWORD });
  return { token: tokenOf(res), body: res.body };
}

describe('FR-04: JWT edge cases', () => {
  it('FR-04: valid signature but no sub -> 401', async () => {
    const t = jwt.sign({}, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 60 });
    const res = await api().get('/api/me').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('FR-04: valid signature but non-string sub -> 401', async () => {
    for (const sub of [123, { id: 'x' }, ['a'], null, true]) {
      const t = jwt.sign({ sub }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 60 });
      const res = await api().get('/api/me').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
    }
  });

  it('FR-04: valid signature but sub is not an existing user id -> 401', async () => {
    for (const sub of ['', 'nonexistent', "' OR 1=1 --"]) {
      const t = jwt.sign({ sub }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 60 });
      const res = await api().get('/api/me').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
    }
  });

  it('FR-04: token without exp is accepted only if signed correctly (never with wrong secret)', async () => {
    const { user } = await createUser();
    const bad = jwt.sign({ sub: user.id }, 'x'.repeat(40));
    expect((await api().get('/api/me').set('Authorization', `Bearer ${bad}`)).status).toBe(401);
  });

  it('FR-04: "Bearer" with no token and no cookie -> 401', async () => {
    expect((await api().get('/api/me').set('Authorization', 'Bearer')).status).toBe(401);
    expect((await api().get('/api/me').set('Authorization', 'Bearer ')).status).toBe(401);
  });

  it('FR-04: non-Bearer schemes are not accepted as credentials', async () => {
    const { user } = await createUser();
    const t = jwt.sign({}, env.JWT_SECRET, { subject: user.id, expiresIn: 60 });
    expect((await api().get('/api/me').set('Authorization', `Basic ${t}`)).status).toBe(401);
    expect((await api().get('/api/me').set('Authorization', t)).status).toBe(401);
    expect((await api().get('/api/me').set('Authorization', `Bearer ${t} extra`)).status).toBe(401);
  });

  it('FR-04: very long Authorization header -> rejected cleanly, no 500', async () => {
    const res = await api().get('/api/me').set('Authorization', `Bearer ${'A'.repeat(8000)}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    const huge = await api().get('/api/me').set('Cookie', `token=${'A'.repeat(8000)}`);
    expect(huge.status).toBe(401);
  });

  it('FR-04: cookie and different Bearer -> deterministic, never mixes users (Bearer wins)', async () => {
    const a = await createUser({ email: 'mix-a@test.local' });
    const b = await createUser({ email: 'mix-b@test.local' });
    const ta = (await login(a.user.email)).token;
    const tb = (await login(b.user.email)).token;
    for (let i = 0; i < 3; i++) {
      const r = await api().get('/api/me').set('Cookie', `token=${ta}`).set('Authorization', `Bearer ${tb}`);
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(b.user.id);
      expect(r.body.email).toBe(b.user.email);
    }
    const r2 = await api().get('/api/me').set('Cookie', `token=${tb}`).set('Authorization', `Bearer ${ta}`);
    expect(r2.body.id).toBe(a.user.id);
  });

  it('FR-04: invalid Bearer plus valid cookie -> 401 (no silent fallback to the cookie user)', async () => {
    const a = await createUser({ email: 'fallback@test.local' });
    const ta = (await login(a.user.email)).token;
    const r = await api().get('/api/me').set('Cookie', `token=${ta}`).set('Authorization', 'Bearer not.a.jwt');
    expect(r.status).toBe(401);
  });

  it('FR-04: PATCH /me with cookie of A and Bearer of B only modifies B', async () => {
    const a = await createUser({ email: 'patch-a@test.local' });
    const b = await createUser({ email: 'patch-b@test.local' });
    const ta = (await login(a.user.email)).token;
    const tb = (await login(b.user.email)).token;
    const r = await api().patch('/api/me').set('Cookie', `token=${ta}`).set('Authorization', `Bearer ${tb}`).send({ name: 'Only B' });
    expect(r.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.user.id } })).name).toBe('Only B');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).name).toBe(a.user.name);
  });
});

describe('NFR-04: mass assignment', () => {
  it('FR-01: register ignores id, passwordHash, createdAt', async () => {
    const forgedId = '00000000-0000-4000-8000-000000000001';
    const forgedDate = '2001-01-01T00:00:00.000Z';
    const res = await api().post('/api/auth/register').send({
      name: 'Mass',
      email: 'mass@test.local',
      password: PASSWORD,
      id: forgedId,
      passwordHash: 'plain-evil-hash',
      createdAt: forgedDate,
      role: 'admin',
    });
    // zod strips unknown keys (201) or rejects (400); either way nothing may take effect
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.id).not.toBe(forgedId);
      expect(res.body.createdAt).not.toBe(forgedDate);
      const row = await prisma.user.findUniqueOrThrow({ where: { email: 'mass@test.local' } });
      expect(row.id).not.toBe(forgedId);
      expect(row.createdAt.toISOString()).not.toBe(forgedDate);
      expect(row.passwordHash).not.toBe('plain-evil-hash');
      expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect((await api().post('/api/auth/login').send({ email: 'mass@test.local', password: PASSWORD })).status).toBe(200);
    } else {
      expect(await prisma.user.findUnique({ where: { email: 'mass@test.local' } })).toBeNull();
    }
  });

  it('FR-02: PATCH /me ignores id, passwordHash, createdAt (DB unchanged)', async () => {
    const { user } = await createUser({ email: 'massp@test.local' });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const { token } = await login(user.email);
    const res = await api()
      .patch('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Renamed',
        id: '00000000-0000-4000-8000-000000000002',
        passwordHash: 'plain-evil-hash',
        createdAt: '2001-01-01T00:00:00.000Z',
      });
    expect([200, 400]).toContain(res.status);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.id).toBe(before.id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    expect(after.email).toBe(before.email);
    expect(await prisma.user.findUnique({ where: { id: '00000000-0000-4000-8000-000000000002' } })).toBeNull();
    if (res.status === 200) expect(after.name).toBe('Renamed');
    else expect(after.name).toBe(before.name);
  });

  it('FR-02: PATCH /me with only forbidden fields changes nothing', async () => {
    const { user } = await createUser({ email: 'massq@test.local' });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const { token } = await login(user.email);
    const res = await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({ passwordHash: 'x', id: 'y' });
    expect(res.status).toBe(400);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toEqual(before);
  });

  it('NFR-04: wrongly typed bodies are rejected with 400, not 500', async () => {
    const { user } = await createUser({ email: 'types@test.local' });
    const { token } = await login(user.email);
    const bodies: unknown[] = [
      { name: { $ne: null }, email: 'a@test.local', password: PASSWORD },
      { name: 'x', email: ['a@test.local'], password: PASSWORD },
      { name: 'x', email: 'a@test.local', password: 12345678 },
    ];
    for (const b of bodies) {
      const r = await api().post('/api/auth/register').send(b as object);
      expect(r.status).toBe(400);
    }
    const l = await api().post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(l.status).toBe(400);
    const p = await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({ name: ['a'] });
    expect(p.status).toBe(400);
  });
});

describe('FR-02: email normalisation on PATCH /me', () => {
  it('FR-02: uppercase new email is stored lowercase', async () => {
    const { user } = await createUser({ email: 'norm@test.local' });
    const { token } = await login(user.email);
    const res = await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({ email: 'NORM.Upper@TEST.local', currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('norm.upper@test.local');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.email).toBe('norm.upper@test.local');
    expect((await api().post('/api/auth/login').send({ email: 'NORM.UPPER@test.local', password: PASSWORD })).status).toBe(200);
  });

  it("FR-02: changing to another user's email in different case -> 409 and nothing changes", async () => {
    const other = await createUser({ email: 'victim@test.local' });
    const { user } = await createUser({ email: 'attacker@test.local' });
    const { token } = await login(user.email);
    for (const e of ['VICTIM@test.local', 'Victim@Test.Local', '  victim@test.local  ']) {
      const res = await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({ email: e, currentPassword: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe('attacker@test.local');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } })).email).toBe('victim@test.local');
  });

  it('FR-02: re-submitting own email in different case is not a conflict', async () => {
    const { user } = await createUser({ email: 'same@test.local' });
    const { token } = await login(user.email);
    const res = await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({ email: 'SAME@test.local', currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('same@test.local');
  });

  it('FR-02: email change with wrong currentPassword -> 403 and email unchanged', async () => {
    const { user } = await createUser({ email: 'wrongcp@test.local' });
    const { token } = await login(user.email);
    const res = await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({ email: 'hijack@test.local', currentPassword: 'WrongPassword1' });
    expect(res.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe('wrongcp@test.local');
  });
});

describe('NFR-01: JWT after password change (sessions are ended)', () => {
  it('NFR-01: old JWT is rejected (401) after password change; new password works', async () => {
    const { user } = await createUser({ email: 'stateless@test.local' });
    const { token: loginToken } = await login(user.email);
    // A token issued before the change (iat in the past).
    const oldToken = jwt.sign({ iat: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, { subject: user.id, algorithm: 'HS256', expiresIn: 3600 });
    expect((await api().get('/api/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(200);
    const res = await api().patch('/api/me').set('Authorization', `Bearer ${loginToken}`).send({ password: 'NewPassword456!', currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect((await api().get('/api/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);
    // The re-issued cookie keeps the current session alive.
    const fresh = tokenOf(res);
    expect((await api().get('/api/me').set('Authorization', `Bearer ${fresh}`)).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email: user.email, password: 'NewPassword456!' })).status).toBe(200);
    // New hash is bcrypt cost 12 and differs from the plaintext.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(row.passwordHash).not.toContain('NewPassword456!');
    expect(row.passwordChangedAt).not.toBeNull();
  });
});

describe('NFR-06: error responses do not leak internals', () => {
  it('NFR-06: error bodies have only the documented shape and no hash, stack or raw token', async () => {
    const { user } = await createUser({ email: 'leak@test.local' });
    const { token } = await login(user.email);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const garbage = 'garbage.token.value';

    const responses = [
      await api().get('/api/me'),
      await api().get('/api/me').set('Authorization', `Bearer ${garbage}`),
      await api().post('/api/auth/login').send({ email: user.email, password: 'WrongPassword1' }),
      await api().post('/api/auth/login').send({}),
      await api().post('/api/auth/register').send({ name: 'x', email: user.email, password: PASSWORD }),
      await api().post('/api/auth/register').send({ email: 'bad' }),
      await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({ password: 'NewPassword456!', currentPassword: 'nope-nope' }),
      await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({}),
      await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": '),
    ];
    for (const r of responses) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      const text = JSON.stringify(r.body);
      expect(Object.keys(r.body)).toEqual(['error']);
      expect(r.body.error.code).toEqual(expect.any(String));
      expect(r.body.error.message).toEqual(expect.any(String));
      expect(text).not.toContain(row.passwordHash);
      expect(text).not.toMatch(/passwordHash|\$2[aby]\$/);
      expect(text).not.toContain(token);
      expect(text).not.toContain(garbage);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toMatch(/\bat\s.+\.(ts|js):\d+/); // stack frame
      expect(text).not.toMatch(/stack|node_modules|prisma/i);
    }
  });

  it('NFR-06: malformed JSON body -> 400 (not 500) with no parser internals', async () => {
    const r = await api().post('/api/auth/register').set('Content-Type', 'application/json').send('{"name": ');
    expect(r.status).toBe(400);
    expect(r.body.error.message).toEqual(expect.any(String));
    expect(JSON.stringify(r.body)).not.toMatch(/SyntaxError|node_modules|\.js:\d+/);
  });
});

describe('FR-01/FR-02: responses match the documented User shape', () => {
  it('AC-01: register, login, GET /me, PATCH /me return exactly {id,name,email,createdAt}', async () => {
    const reg = await api().post('/api/auth/register').send({ name: 'Shape', email: 'shape@test.local', password: PASSWORD });
    expect(reg.status).toBe(201);
    expect(Object.keys(reg.body).sort()).toEqual(USER_KEYS);

    const lg = await api().post('/api/auth/login').send({ email: 'shape@test.local', password: PASSWORD });
    expect(lg.status).toBe(200);
    expect(Object.keys(lg.body).sort()).toEqual(USER_KEYS);

    const token = tokenOf(lg);
    const me = await api().get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(Object.keys(me.body).sort()).toEqual(USER_KEYS);

    const patched = await api().patch('/api/me').set('Authorization', `Bearer ${token}`).send({ name: 'Shape 2' });
    expect(patched.status).toBe(200);
    expect(Object.keys(patched.body).sort()).toEqual(USER_KEYS);

    for (const b of [reg.body, lg.body, me.body, patched.body]) {
      expect(b.id).toEqual(expect.any(String));
      expect(b.name).toEqual(expect.any(String));
      expect(b.email).toBe('shape@test.local');
      expect(Number.isNaN(Date.parse(b.createdAt))).toBe(false);
      expect(new Date(b.createdAt).toISOString()).toBe(b.createdAt);
    }
    expect(reg.body.id).toBe(me.body.id);
    expect(reg.body.createdAt).toBe(patched.body.createdAt);
  });

  it('FR-04: logout returns 204 with an empty body', async () => {
    const r = await api().post('/api/auth/logout');
    expect(r.status).toBe(204);
    expect(r.text).toBe('');
  });

  it('FR-04: JWT issued carries only sub/iat/exp (no email or hash in the payload)', async () => {
    const lg = await api().post('/api/auth/register').send({ name: 'Claims', email: 'claims@test.local', password: PASSWORD });
    const payload = jwt.decode(tokenOf(lg)) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
    expect(payload.sub).toBe(lg.body.id);
  });
});
