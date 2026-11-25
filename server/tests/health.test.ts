import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api } from './helpers/app.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { apiNotFound, errorHandler } from '../src/middleware/errorHandler.js';
import { validate } from '../src/lib/validate.js';
import { buildLogger } from '../src/lib/logger.js';
import { AppError } from '../src/lib/errors.js';

beforeAll(resetDb);
afterAll(disconnectDb);

describe('health', () => {
  it('returns 200 with db ok', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });
});

describe('error handling', () => {
  it('unknown /api route returns 404 in the API error shape', async () => {
    const res = await api().get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
  });

  function testApp() {
    const app = express();
    app.use(express.json());
    app.post('/api/echo', (req, res) => {
      const { body } = validate(req, {
        body: z.object({ email: z.string().email('Must be a valid email'), age: z.number().min(18) }),
      });
      res.json(body);
    });
    app.get('/api/forbidden', () => {
      throw new AppError(403, 'FORBIDDEN', 'Nope.');
    });
    app.get('/api/boom', () => {
      throw new Error('secret internals');
    });
    app.use('/api', apiNotFound);
    app.use(errorHandler);
    return app;
  }

  it('ZodError becomes 400 VALIDATION_ERROR with fields', async () => {
    const res = await request(testApp()).post('/api/echo').send({ email: 'bad', age: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields.email).toBe('Must be a valid email');
    expect(res.body.error.fields.age).toBeDefined();
    expect(res.body.error.message.length).toBeGreaterThan(5);
  });

  it('AppError maps to its status and code', async () => {
    const res = await request(testApp()).get('/api/forbidden');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'Nope.' } });
  });

  it('unknown errors become generic 500 without leaking details', async () => {
    const res = await request(testApp()).get('/api/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
  });
});

describe('NFR-06: logger redaction', () => {
  it('redacts passwords, tokens and auth headers', () => {
    let out = '';
    const stream = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = buildLogger(stream, { level: 'info' });
    log.info(
      {
        password: 'hunter2-pw',
        token: 'tok-abc-123',
        body: { password: 'nested-pw', currentPassword: 'old-pw' },
        req: { headers: { authorization: 'Bearer jwt-secret', cookie: 'token=jwt-cookie' } },
        res: { headers: { 'set-cookie': ['token=jwt-set'] } },
      },
      'test',
    );
    for (const secret of ['hunter2-pw', 'tok-abc-123', 'nested-pw', 'old-pw', 'jwt-secret', 'jwt-cookie', 'jwt-set']) {
      expect(out).not.toContain(secret);
    }
    const parsed = JSON.parse(out);
    expect(parsed.password).toBe('[Redacted]');
    expect(parsed.token).toBe('[Redacted]');
    expect(parsed.req.headers.authorization).toBe('[Redacted]');
  });
});
