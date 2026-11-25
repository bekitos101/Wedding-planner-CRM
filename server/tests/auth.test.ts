import { Writable } from 'node:stream';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { api } from './helpers/app.js';
import { createUser } from './helpers/factories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

const PASSWORD = 'Password123!';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

function tokenCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith('token='));
  if (!c) throw new Error('no token cookie');
  return c;
}
const cookieValue = (setCookie: string) => setCookie.split(';')[0]!;

describe('register', () => {
  it('AC-01: planner can register and is logged in', async () => {
    const res = await api().post('/api/auth/register').send({ name: '  Rita Planner ', email: ' Rita@Test.Local ', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      name: 'Rita Planner',
      email: 'rita@test.local',
      createdAt: expect.any(String),
    });
    const cookie = tokenCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=604800/);
    const me = await api().get('/api/me').set('Cookie', cookieValue(cookie));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('rita@test.local');
  });

  it('FR-03/NFR-01: password stored as bcrypt hash, never returned', async () => {
    const res = await api().post('/api/auth/register').send({ name: 'Hash Test', email: 'hash@test.local', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'hash@test.local' } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
    const me = await api().get('/api/me').set('Authorization', `Bearer ${jwt.sign({}, env.JWT_SECRET, { subject: row.id })}`);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);
  });

  it('FR-01: invalid input -> 400 with field messages', async () => {
    const bad = await api().post('/api/auth/register').send({ email: 'nope', password: 'short' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['email', 'name', 'password']);

    const long = await api().post('/api/auth/register').send({ name: 'x', email: 'long@test.local', password: 'a'.repeat(73) });
    expect(long.status).toBe(400);
    expect(long.body.error.fields.password).toBeDefined();

    const blankName = await api().post('/api/auth/register').send({ name: '   ', email: 'b@test.local', password: PASSWORD });
    expect(blankName.status).toBe(400);
    expect(blankName.body.error.fields.name).toBeDefined();
  });

  it('FR-01: duplicate email (case-insensitive) -> 409', async () => {
    await api().post('/api/auth/register').send({ name: 'A', email: 'dup@test.local', password: PASSWORD });
    const res = await api().post('/api/auth/register').send({ name: 'B', email: 'DUP@Test.Local', password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('login / logout', () => {
  it('AC-01: planner can log in and log out', async () => {
    const { user } = await createUser({ email: 'login@test.local' });
    const login = await api().post('/api/auth/login').send({ email: 'LOGIN@test.local', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.id).toBe(user.id);
    expect(login.body.passwordHash).toBeUndefined();
    const cookie = tokenCookie(login);
    expect(cookie).toMatch(/HttpOnly/i);

    const logout = await api().post('/api/auth/logout').set('Cookie', cookieValue(cookie));
    expect(logout.status).toBe(204);
    const cleared = tokenCookie(logout);
    expect(cleared).toMatch(/^token=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('FR-01: logout works even when not logged in', async () => {
    const res = await api().post('/api/auth/logout');
    expect(res.status).toBe(204);
  });

  it('FR-04: wrong password and unknown email give the same 401 body', async () => {
    await createUser({ email: 'known@test.local' });
    const wrong = await api().post('/api/auth/login').send({ email: 'known@test.local', password: 'WrongPassword1' });
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@test.local', password: 'WrongPassword1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('UNAUTHENTICATED');
    expect(wrong.body.error.message).toBe('Email or password is incorrect.');
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('FR-01: login with missing fields -> 400', async () => {
    const res = await api().post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.fields.email).toBeDefined();
    expect(res.body.error.fields.password).toBeDefined();
  });
});

describe('FR-04: /me requires authentication', () => {
  it('no token -> 401', async () => {
    const res = await api().get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('garbage token -> 401', async () => {
    expect((await api().get('/api/me').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401);
    expect((await api().get('/api/me').set('Cookie', 'token=garbage')).status).toBe(401);
  });

  it('token signed with another secret -> 401', async () => {
    const { user } = await createUser();
    const t = jwt.sign({}, 'another-secret-another-secret-another', { subject: user.id, expiresIn: 60 });
    expect((await api().get('/api/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('expired token -> 401', async () => {
    const { user } = await createUser();
    const t = jwt.sign({}, env.JWT_SECRET, { subject: user.id, expiresIn: -10 });
    expect((await api().get('/api/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('alg "none" token -> 401', async () => {
    const { user } = await createUser();
    const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    expect((await api().get('/api/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('token with another HMAC algorithm (HS512) -> 401', async () => {
    const { user } = await createUser();
    const t = jwt.sign({}, env.JWT_SECRET, { subject: user.id, algorithm: 'HS512', expiresIn: 60 });
    expect((await api().get('/api/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('token of a deleted user -> 401', async () => {
    const { user } = await createUser();
    const t = jwt.sign({}, env.JWT_SECRET, { subject: user.id, algorithm: 'HS256', expiresIn: 60 });
    expect((await api().get('/api/me').set('Authorization', `Bearer ${t}`)).status).toBe(200);
    await prisma.user.delete({ where: { id: user.id } });
    expect((await api().get('/api/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('Bearer header works as well as cookie', async () => {
    const { user } = await createUser();
    const login = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    const token = cookieValue(tokenCookie(login)).slice('token='.length);
    const res = await api().get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
  });
});

describe('PATCH /me', () => {
  async function loggedIn(email?: string) {
    const { user } = await createUser(email ? { email } : {});
    const login = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    return { user, cookie: cookieValue(tokenCookie(login)) };
  }

  it('FR-02: name only needs no current password', async () => {
    const { cookie } = await loggedIn();
    const res = await api().patch('/api/me').set('Cookie', cookie).send({ name: ' New Name ' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('FR-02: unauthenticated -> 401', async () => {
    expect((await api().patch('/api/me').send({ name: 'x' })).status).toBe(401);
  });

  it('FR-02: email change without currentPassword -> 400 fields.currentPassword', async () => {
    const { cookie } = await loggedIn();
    const res = await api().patch('/api/me').set('Cookie', cookie).send({ email: 'changed@test.local' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.currentPassword).toBeDefined();
  });

  it('FR-02: wrong currentPassword -> 403', async () => {
    const { cookie } = await loggedIn();
    const res = await api().patch('/api/me').set('Cookie', cookie).send({ password: 'NewPassword456!', currentPassword: 'nope-nope' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Current password is incorrect.');
    expect(res.body.error.fields).toEqual({ currentPassword: 'Current password is incorrect' });
  });

  it('NFR-01: password change ends other sessions; PATCH /me cookie keeps the current one', async () => {
    const { user, cookie } = await loggedIn();
    const old = jwt.sign({ iat: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, { subject: user.id, algorithm: 'HS256', expiresIn: 3600 });
    expect((await api().get('/api/me').set('Authorization', `Bearer ${old}`)).status).toBe(200);
    const res = await api().patch('/api/me').set('Cookie', cookie).send({ password: 'NewPassword456!', currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    const reissued = tokenCookie(res);
    expect(reissued).toMatch(/HttpOnly/i);
    expect(reissued).toMatch(/SameSite=Lax/i);
    expect(reissued).toMatch(/Max-Age=604800/);
    expect((await api().get('/api/me').set('Authorization', `Bearer ${old}`)).status).toBe(401);
    expect((await api().get('/api/me').set('Cookie', cookieValue(reissued))).status).toBe(200);
  });

  it('NFR-01: name-only change does not invalidate tokens or touch the cookie', async () => {
    const { user, cookie } = await loggedIn();
    const old = jwt.sign({ iat: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, { subject: user.id, algorithm: 'HS256', expiresIn: 3600 });
    const res = await api().patch('/api/me').set('Cookie', cookie).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await api().get('/api/me').set('Authorization', `Bearer ${old}`)).status).toBe(200);
    expect((await api().get('/api/me').set('Cookie', cookie)).status).toBe(200);
  });

  it('NFR-01: password within 72 characters but over 72 bytes -> 400 fields.password (register and PATCH /me)', async () => {
    const emoji = '😀'.repeat(30); // 30 chars, 120 bytes
    const reg = await api().post('/api/auth/register').send({ name: 'Emoji', email: 'emoji@test.local', password: emoji });
    expect(reg.status).toBe(400);
    expect(reg.body.error.fields.password).toBeDefined();
    const { cookie } = await loggedIn();
    const res = await api().patch('/api/me').set('Cookie', cookie).send({ password: emoji, currentPassword: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.password).toBeDefined();
  });

  it('FR-04: token without exp is rejected', async () => {
    const { user } = await createUser();
    const t = jwt.sign({}, env.JWT_SECRET, { subject: user.id, algorithm: 'HS256' });
    expect((await api().get('/api/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('FR-02: email change succeeds and is normalised; taken email -> 409', async () => {
    await createUser({ email: 'taken@test.local' });
    const { cookie } = await loggedIn();
    const taken = await api().patch('/api/me').set('Cookie', cookie).send({ email: 'Taken@test.local', currentPassword: PASSWORD });
    expect(taken.status).toBe(409);
    const ok = await api().patch('/api/me').set('Cookie', cookie).send({ email: ' NEW.Email@Test.local ', currentPassword: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe('new.email@test.local');
  });

  it('FR-02: password change then login with new password works and old fails', async () => {
    const { user, cookie } = await loggedIn();
    const res = await api().patch('/api/me').set('Cookie', cookie).send({ password: 'NewPassword456!', currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    expect((await api().post('/api/auth/login').send({ email: user.email, password: 'NewPassword456!' })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(401);
  });

  it('FR-02: empty body -> 400', async () => {
    const { cookie } = await loggedIn();
    expect((await api().patch('/api/me').set('Cookie', cookie).send({})).status).toBe(400);
    expect((await api().patch('/api/me').set('Cookie', cookie).send({ currentPassword: PASSWORD })).status).toBe(400);
  });

  it('FR-02: invalid new values -> 400', async () => {
    const { cookie } = await loggedIn();
    const res = await api().patch('/api/me').set('Cookie', cookie).send({ name: '', email: 'bad', password: 'short', currentPassword: PASSWORD });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['email', 'name', 'password']);
  });
});

describe('NFR-06: secrets are not logged', () => {
  it('NFR-06: login request does not log the password or the issued JWT', async () => {
    let out = '';
    const stream = new Writable({
      write(chunk, _e, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = pino({ level: 'info', redact: { paths: (await import('../src/lib/logger.js')).redactPaths, censor: '[Redacted]' } }, stream);
    const secretPassword = 'Sup3r-Secret-Pw-Zq9!';
    await createUser({ email: 'logtest@test.local', password: secretPassword });

    const ok = await request(createApp(log)).post('/api/auth/login').send({ email: 'logtest@test.local', password: secretPassword });
    expect(ok.status).toBe(200);
    const token = cookieValue(tokenCookie(ok)).slice('token='.length);
    await request(createApp(log)).post('/api/auth/login').send({ email: 'logtest@test.local', password: `${secretPassword}x` });
    await request(createApp(log)).get('/api/me').set('Authorization', `Bearer ${token}`);
    await request(createApp(log)).get('/api/me').set('Cookie', `token=${token}`);

    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain(secretPassword);
    expect(out).not.toContain(token);
    expect(out).not.toMatch(/\$2[aby]\$/);
  });
});
