import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createUser } from './helpers/factories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

const MESSAGE = 'Too many attempts. Please try again later.';
const expect429 = (res: request.Response) => {
  expect(res.status).toBe(429);
  expect(res.body.error).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: MESSAGE });
};

describe('login / register / password-change rate limits (NFR-01, NFR-02)', () => {
  it('NFR-01: 10 login attempts per IP+email per 15 min, the 11th is 429 (even with the right password)', async () => {
    const { user, password } = await createUser();
    const app = createApp();
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    }
    expect429(await request(app).post('/api/auth/login').send({ email: user.email, password }));
  });

  it('NFR-01: the key is the lowercased email, so case variants share one counter; other emails are unaffected', async () => {
    const { user, password } = await createUser();
    const { user: other, password: otherPassword } = await createUser();
    const app = createApp();
    for (let i = 0; i < 10; i++) {
      const email = i % 2 ? user.email.toUpperCase() : user.email;
      await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    }
    expect429(await request(app).post('/api/auth/login').send({ email: user.email.toUpperCase(), password }));
    await request(app).post('/api/auth/login').send({ email: other.email, password: otherPassword }).expect(200);
  });

  it('NFR-01: a successful login does not reset the counter', async () => {
    const { user, password } = await createUser();
    const app = createApp();
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' }).expect(401);
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: user.email, password }).expect(200);
    expect429(await request(app).post('/api/auth/login').send({ email: user.email, password }));
  });

  it('NFR-01: per-IP login limit across different emails (overridable)', async () => {
    const app = createApp(undefined, { authLimits: { loginPerIp: { max: 3 } } });
    for (let i = 0; i < 3; i++) await request(app).post('/api/auth/login').send({ email: `nobody${i}@test.local`, password: 'x' }).expect(401);
    expect429(await request(app).post('/api/auth/login').send({ email: 'nobody9@test.local', password: 'x' }));
  });

  it('NFR-01: the default per-IP login limit is 50 per window', async () => {
    const app = createApp(undefined, { authLimits: { loginPerIpAndEmail: { max: 1000 } } });
    for (let i = 0; i < 50; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: `n${i}@test.local`, password: '' });
      expect(res.status).toBe(400); // rejected by validation, still counted
    }
    expect429(await request(app).post('/api/auth/login').send({ email: 'n51@test.local', password: 'x' }));
  });

  it('NFR-01: every app instance has its own counters (fresh app -> allowed again)', async () => {
    const { user } = await createUser();
    const a = createApp();
    for (let i = 0; i < 11; i++) await request(a).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });
    await request(createApp()).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' }).expect(401);
  });

  it('NFR-02: register is limited to 10 per hour per IP (11th is 429)', async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/auth/register').send({ name: 'Rate', email: `rate${i}@test.local`, password: 'Password123!' });
      expect(res.status).toBe(201);
    }
    expect429(await request(app).post('/api/auth/register').send({ name: 'Rate', email: 'rate99@test.local', password: 'Password123!' }));
  });

  it('NFR-01: password-change attempts on PATCH /me are limited to 10 per 15 min per user; other edits are not counted', async () => {
    const { user } = await createUser();
    const { user: other } = await createUser();
    const app = createApp();
    for (let i = 0; i < 12; i++) await request(app).patch('/api/me').set(bearer(user.id)).send({ name: `Name ${i}` }).expect(200);
    for (let i = 0; i < 10; i++) {
      const res = await request(app).patch('/api/me').set(bearer(user.id)).send({ password: 'NewPassword123!', currentPassword: 'wrong-password' });
      expect(res.status).not.toBe(429);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect429(await request(app).patch('/api/me').set(bearer(user.id)).send({ password: 'NewPassword123!', currentPassword: 'wrong-password' }));
    // The limit is per user: someone else is unaffected.
    const res = await request(app).patch('/api/me').set(bearer(other.id)).send({ password: 'NewPassword123!', currentPassword: 'wrong-password' });
    expect(res.status).not.toBe(429);
  });

  it('NFR-06: the 429 body does not echo the submitted email or password', async () => {
    const app = createApp(undefined, { authLimits: { loginPerIpAndEmail: { max: 1 } } });
    await request(app).post('/api/auth/login').send({ email: 'echo@test.local', password: 'SecretPw123!' });
    const res = await request(app).post('/api/auth/login').send({ email: 'echo@test.local', password: 'SecretPw123!' });
    expect429(res);
    expect(JSON.stringify(res.body)).not.toContain('SecretPw123!');
    expect(JSON.stringify(res.body)).not.toContain('echo@test.local');
  });
});
