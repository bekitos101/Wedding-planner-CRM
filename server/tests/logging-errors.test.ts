import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { maskUrl } from '../src/lib/maskUrl.js';
import { prisma } from '../src/lib/prisma.js';
import { apiNotFound, errorHandler } from '../src/middleware/errorHandler.js';
import { createUser } from './helpers/factories.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { assertTestDatabase } from './loadTestEnv.js';

beforeAll(resetDb);
afterAll(disconnectDb);

describe('NFR-06: tokens in URLs are never logged', () => {
  it('maskUrl redacts the rsvp token segment', () => {
    expect(maskUrl('/api/rsvp/abc123?x=1')).toBe('/api/rsvp/[Redacted]?x=1');
    expect(maskUrl('/api/health')).toBe('/api/health');
  });

  it('request logs never contain the raw RSVP token', async () => {
    let out = '';
    const stream = new Writable({
      write(chunk, _e, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = pino({ level: 'info' }, stream);
    await request(createApp(log)).get('/api/rsvp/abc123');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain('abc123');
    expect(out).toContain('[Redacted]');
  });
});

describe('error mapping', () => {
  function app() {
    const a = express();
    a.use(express.json({ limit: '1kb' }));
    a.post('/api/echo', (req, res) => res.json(req.body));
    a.post('/api/dup', async (req, res, next) => {
      try {
        res.json(await prisma.user.create({ data: { name: 'x', email: req.body.email, passwordHash: 'h' } }));
      } catch (e) {
        next(e);
      }
    });
    a.post('/api/missing', async (_req, res, next) => {
      try {
        res.json(await prisma.user.update({ where: { id: 'does-not-exist' }, data: { name: 'y' } }));
      } catch (e) {
        next(e);
      }
    });
    a.use('/api', apiNotFound);
    a.use(errorHandler);
    return a;
  }

  it('oversized body returns 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app()).post('/api/echo').send({ big: 'x'.repeat(5000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.error.message).toMatch(/too large/i);
  });

  it('malformed JSON returns 400 VALIDATION_ERROR', async () => {
    const res = await request(app()).post('/api/echo').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('Prisma P2002 maps to 409 CONFLICT', async () => {
    const { user } = await createUser();
    const res = await request(app()).post('/api/dup').send({ email: user.email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toBe('This record already exists.');
    expect(res.body.error.message).not.toContain(user.email);
  });

  it('Prisma P2025 maps to 404 NOT_FOUND', async () => {
    const res = await request(app()).post('/api/missing').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('test isolation guard', () => {
  it('refuses a non-_test database', () => {
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5432/wedding_organizer')).toThrow(/_test/);
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5432/wedding_organizer_test')).not.toThrow();
  });
});
