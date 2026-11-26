import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env, parseEnv } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';
import { maskUrl } from '../src/lib/maskUrl.js';
import { prisma } from '../src/lib/prisma.js';
import { safeErrorInfo } from '../src/lib/safeError.js';
import { apiNotFound, errorHandler, frameLines } from '../src/middleware/errorHandler.js';
import { csrfGuard, securityHeaders } from '../src/middleware/security.js';
import { disconnectDb, resetDb } from './helpers/db.js';

beforeAll(resetDb);
afterAll(disconnectDb);

describe('NFR-06: error logging never carries secrets', () => {
  it('NFR-06: a Prisma validation error is logged without its message or argument values', async () => {
    const secret = 'SUPER-SECRET-HASH-VALUE-12345';
    const a = express();
    a.get('/api/boom', async (_req, _res, next) => {
      try {
        // email must be a string: Prisma rejects it with a message that echoes the arguments.
        await prisma.user.create({ data: { name: 'x', email: 123 as unknown as string, passwordHash: secret } });
      } catch (e) {
        next(e);
      }
    });
    a.use('/api', apiNotFound);
    a.use(errorHandler);
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      const res = await request(a).get('/api/boom');
      expect(res.status).toBe(500);
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain(secret);
      expect(logged).toContain('PrismaClientValidationError');
      expect(JSON.stringify(res.body)).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });

  it('NFR-06: frameLines keeps only the "at ..." lines of a stack', () => {
    const stack = ['Error: invalid args { passwordHash: "s3cret" }', '    at foo (file.ts:1:1)', '    at bar (file.ts:2:2)'].join('\n');
    const out = frameLines(stack);
    expect(out).not.toContain('s3cret');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('NFR-06: job/startup error summaries contain name and code only, never the message', () => {
    const err = Object.assign(new Error('connect failed for postgresql://user:pw@host/db'), { code: 'P1001' });
    expect(safeErrorInfo(err)).toEqual({ name: 'Error', code: 'P1001' });
    expect(JSON.stringify(safeErrorInfo(err))).not.toContain('pw@host');
    expect(safeErrorInfo('plain string secret')).toEqual({ name: 'UnknownError' });
  });

  it('NFR-06: P2002 unique violations answer a generic 409 without column names', async () => {
    const a = express();
    a.use(express.json());
    a.post('/api/dup', async (req, res, next) => {
      try {
        res.json(await prisma.user.create({ data: { name: 'x', email: req.body.email, passwordHash: 'h' } }));
      } catch (e) {
        next(e);
      }
    });
    a.use(errorHandler);
    await request(a).post('/api/dup').send({ email: 'dup-generic@test.local' }).expect(200);
    const res = await request(a).post('/api/dup').send({ email: 'dup-generic@test.local' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', message: 'This record already exists.' });
  });
});

describe('NFR-03/NFR-06: invitation tokens are masked case-insensitively', () => {
  const token = 'A'.repeat(20) + 'b'.repeat(20) + '-_9';

  it('maskUrl redacts /Rsvp/ and /RSVP/ too', () => {
    expect(maskUrl(`/api/Rsvp/${token}?x=1`)).toBe('/api/Rsvp/[Redacted]?x=1');
    expect(maskUrl(`/api/RSVP/${token}`)).toBe('/api/RSVP/[Redacted]');
  });

  it('request logs never contain a token sent to /api/Rsvp/<token>', async () => {
    expect(token).toHaveLength(43);
    let out = '';
    const stream = new Writable({
      write(chunk, _e, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = pino({ level: 'info' }, stream);
    const res = await request(createApp(log)).get(`/api/Rsvp/${token}`);
    expect([404, 410]).toContain(res.status); // Express routing is case-insensitive: it reached the RSVP handler
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain(token);
  });
});

describe('NFR-07: security headers', () => {
  it('NFR-07: API responses carry the baseline security headers (no HSTS outside production)', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('NFR-07: error responses carry the headers too', async () => {
    const res = await request(createApp()).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('NFR-07: HSTS is sent only when production is on', async () => {
    const mk = (production: boolean) => {
      const a = express();
      a.use(securityHeaders({ production }));
      a.get('/x', (_req, res) => res.json({}));
      return a;
    };
    expect((await request(mk(true)).get('/x')).headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect((await request(mk(false)).get('/x')).headers['strict-transport-security']).toBeUndefined();
  });
});

describe('NFR-07/NFR-06: production environment checks', () => {
  const good = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/app',
    JWT_SECRET: 'x7Qm2vLr9Zk4Wp8Nd3Hs6Tb1Yc5Fg0AjKeUo',
    APP_BASE_URL: 'https://planner.example.com',
  };
  const messages = (src: Record<string, string>) => {
    const r = parseEnv(src);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('NFR-07: a valid production configuration is accepted', () => {
    expect(parseEnv(good).success).toBe(true);
  });

  it('NFR-07: production refuses a non-https APP_BASE_URL', () => {
    expect(messages({ ...good, APP_BASE_URL: 'http://planner.example.com' }).join()).toContain('APP_BASE_URL');
  });

  it.each([
    ['change-me placeholder', 'change-me-change-me-change-me-change-me'],
    ['test secret from .env.test.example', 'test-secret-test-secret-test-secret-123'],
    ['embedded change-me', 'prefix-CHANGE-ME-suffix-0123456789abcdef'],
  ])('NFR-06: production refuses a JWT secret that is the %s', (_n, secret) => {
    expect(messages({ ...good, JWT_SECRET: secret }).join()).toContain('JWT_SECRET');
  });

  it('NFR-07: development and test accept http and the test secret', () => {
    const dev = { ...good, NODE_ENV: 'development', APP_BASE_URL: 'http://localhost:4200', JWT_SECRET: 'test-secret-test-secret-test-secret-123' };
    expect(parseEnv(dev).success).toBe(true);
    expect(parseEnv({ ...dev, NODE_ENV: 'test' }).success).toBe(true);
  });
});

describe('CSRF guard: cross-site state-changing requests are rejected', () => {
  const blocked = (res: request.Response) => {
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'FORBIDDEN', message: 'Cross-site request blocked.' });
  };

  it('Sec-Fetch-Site: cross-site on POST -> 403', async () => {
    blocked(await request(createApp()).post('/api/auth/logout').set('Sec-Fetch-Site', 'cross-site'));
  });

  it('a foreign Origin on POST / PATCH / DELETE -> 403', async () => {
    const app = createApp();
    blocked(await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example'));
    blocked(await request(app).patch('/api/me').set('Origin', 'https://evil.example').send({ name: 'x' }));
    blocked(await request(app).delete('/api/weddings/x').set('Origin', 'https://evil.example'));
    blocked(await request(app).post('/api/auth/logout').set('Origin', 'null'));
  });

  it('same-origin: Origin equal to APP_BASE_URL (Angular dev proxy / production) is allowed', async () => {
    const origin = new URL(env.APP_BASE_URL).origin;
    const res = await request(createApp()).post('/api/auth/logout').set('Origin', origin).set('Sec-Fetch-Site', 'same-origin');
    expect(res.status).toBe(204);
    // Cross-origin but same-site (frontend :4200 calling the API directly) is also fine.
    expect((await request(createApp()).post('/api/auth/logout').set('Origin', origin).set('Sec-Fetch-Site', 'same-site')).status).toBe(204);
  });

  it('same-origin: Origin that matches the Host the request was sent to (direct localhost:3000) is allowed', async () => {
    const res = await request(createApp()).post('/api/auth/logout').set('Host', 'localhost:3000').set('Origin', 'http://localhost:3000');
    expect(res.status).toBe(204);
  });

  it('no Origin header (supertest, curl, server-to-server) is allowed', async () => {
    expect((await request(createApp()).post('/api/auth/logout')).status).toBe(204);
  });

  it('safe methods are never blocked, even cross-site', async () => {
    const res = await request(createApp()).get('/api/health').set('Sec-Fetch-Site', 'cross-site').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
  });

  it('csrfGuard unit: runs before body parsing and protects any path it is mounted on', async () => {
    const a = express();
    a.use(csrfGuard('https://planner.example.com'));
    a.post('/y', (_req, res) => res.json({ ok: true }));
    a.use(((err, _req, res, _next) => res.status(err.status ?? 500).json({ msg: err.message })) as express.ErrorRequestHandler);
    expect((await request(a).post('/y').set('Origin', 'https://planner.example.com')).status).toBe(200);
    expect((await request(a).post('/y').set('Origin', 'https://planner.example.com.evil.io')).status).toBe(403);
  });
});
