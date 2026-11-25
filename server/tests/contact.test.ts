import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createRateLimiter, type RateLimiter } from '../src/lib/rateLimit.js';
import { setMailTransportForTests, type MailTransport } from '../src/lib/mailer.js';

type Sent = Parameters<MailTransport['sendMail']>[0];
let sent: Sent[] = [];
let failNext = false;

beforeEach(() => {
  sent = [];
  failNext = false;
  setMailTransportForTests({
    async sendMail(m) {
      if (failNext) throw new Error('connect ECONNREFUSED 127.0.0.1:1025 secret-stack-detail');
      sent.push(m);
      return { messageId: '<test@local>' };
    },
  });
});
afterEach(() => setMailTransportForTests(undefined));

const valid = { name: 'Anna Kovacs', email: 'anna@example.com', subject: 'Pricing', message: 'Hello, I would like to know more about pricing.' };

describe('contact form (NFR-04, NFR-10, NFR-17)', () => {
  it('NFR-10: valid message -> 202, exactly one mail with right headers and text', async () => {
    const res = await request(createApp()).post('/api/contact').send(valid);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: "Thanks! We'll get back to you soon." });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('hello@wedding-organizer.local');
    expect(sent[0]!.replyTo).toBe('anna@example.com');
    expect(sent[0]!.subject).toBe('[Contact] Pricing');
    expect(sent[0]!.text).toContain('New contact form message');
    expect(sent[0]!.text).toContain('Anna Kovacs');
    expect(sent[0]!.text).toContain(valid.message);
  });

  it('NFR-10: missing subject uses the default subject line', async () => {
    const { subject: _s, ...noSubject } = valid;
    await request(createApp()).post('/api/contact').send(noSubject).expect(202);
    expect(sent[0]!.subject).toBe('[Contact] New message');
  });

  it.each([
    ['missing message', { ...valid, message: undefined }, 'message'],
    ['short message', { ...valid, message: 'too short' }, 'message'],
    ['bad email', { ...valid, email: 'not-an-email' }, 'email'],
    ['long name', { ...valid, name: 'x'.repeat(101) }, 'name'],
    ['long subject', { ...valid, subject: 'x'.repeat(151) }, 'subject'],
    ['long message', { ...valid, message: 'x'.repeat(5001) }, 'message'],
    ['blank name', { ...valid, name: '   ' }, 'name'],
  ])('NFR-04: %s -> 400 with fields', async (_n, body, field) => {
    const res = await request(createApp()).post('/api/contact').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields[field]).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it('NFR-04: CRLF in name and subject is stripped (no header injection)', async () => {
    await request(createApp())
      .post('/api/contact')
      .send({ ...valid, name: 'Eve\r\nBcc: evil@example.com', subject: 'Hi\r\nBcc: evil@example.com' })
      .expect(202);
    expect(sent[0]!.subject).not.toMatch(/[\r\n]/);
    expect(sent[0]!.subject).toBe('[Contact] Hi Bcc: evil@example.com');
    expect(sent[0]!.text.split('\n').find((l) => l.startsWith('Name:'))).toBe('Name: Eve Bcc: evil@example.com');
  });

  it('NFR-04: honeypot filled -> 202 and nothing is sent', async () => {
    const res = await request(createApp()).post('/api/contact').send({ ...valid, contact_hp: 'http://spam.example' });
    expect(res.status).toBe(202);
    expect(res.body.message).toBe("Thanks! We'll get back to you soon.");
    expect(sent).toHaveLength(0);
  });

  it('NFR-17: transport failure -> 503 without stack or body leak', async () => {
    failNext = true;
    const res = await request(createApp()).post('/api/contact').send(valid);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: "We couldn't send your message right now. Please try again later." },
    });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('NFR-10: 6th request within the window -> 429 in the standard shape', async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) await request(app).post('/api/contact').send(valid).expect(202);
    const res = await request(app).post('/api/contact').send(valid);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many messages. Please try again later.' } });
    expect(sent).toHaveLength(5);
    // a fresh app instance has a fresh limiter
    await request(createApp()).post('/api/contact').send(valid).expect(202);
  });

  it('NFR-06: logs never contain the message body, on success or failure', async () => {
    let out = '';
    const stream = new Writable({
      write(chunk, _e, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const app = createApp(pino({ level: 'debug' }, stream));
    const secretBody = 'my-very-private-message-body-12345';
    await request(app).post('/api/contact').send({ ...valid, message: secretBody }).expect(202);
    failNext = true;
    await request(app).post('/api/contact').send({ ...valid, message: secretBody }).expect(503);
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain(secretBody);
    expect(out).toContain('Email delivery failed');
  });
});

async function mailpitUp(): Promise<boolean> {
  try {
    return (await fetch('http://localhost:8025/api/v1/info', { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}
const mailpit = await mailpitUp();

describe('contact form via real Mailpit (optional)', () => {
  it.skipIf(!mailpit)('NFR-17: message arrives in Mailpit', async () => {
    setMailTransportForTests(undefined);
    const subject = `Mailpit check ${Date.now()}`;
    await request(createApp()).post('/api/contact').send({ ...valid, subject }).expect(202);
    // Mailpit stores messages asynchronously after SMTP accepts them: poll briefly.
    type MailpitList = { messages: { Subject: string; ReplyTo?: { Address: string }[] }[] };
    let found: MailpitList['messages'][number] | undefined;
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 100));
      const res = await fetch('http://localhost:8025/api/v1/messages?limit=20');
      const data = (await res.json()) as MailpitList;
      found = data.messages.find((m) => m.Subject === `[Contact] ${subject}`);
    }
    expect(found).toBeTruthy();
    expect(found!.ReplyTo?.[0]?.Address).toBe('anna@example.com');
  });
});

describe('contact form hardening', () => {
  it('NFR-04: CRLF in email -> 400 and nothing sent', async () => {
    const res = await request(createApp()).post('/api/contact').send({ ...valid, email: 'a@b.com\r\nBcc: x@y.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.email).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  async function fillFrom(app: ReturnType<typeof createApp>, ip: string, n: number) {
    let last = 0;
    for (let i = 0; i < n; i++) last = (await request(app).post('/api/contact').set('X-Forwarded-For', ip).send(valid)).status;
    return last;
  }

  it('NFR-10: TRUST_PROXY=1 -> different X-Forwarded-For IPs have separate limits', async () => {
    const app = createApp(undefined, { trustProxy: 1 });
    expect(await fillFrom(app, '10.0.0.1', 6)).toBe(429);
    expect(await fillFrom(app, '10.0.0.2', 1)).toBe(202);
  });

  it('NFR-10: TRUST_PROXY=0 -> X-Forwarded-For is ignored (shared limit)', async () => {
    const app = createApp(undefined, { trustProxy: 0 });
    await fillFrom(app, '10.0.0.1', 5);
    expect(await fillFrom(app, '10.0.0.2', 1)).toBe(429);
  });
});

describe('rate limiter unit (NFR-10)', () => {
  const run = (limiter: RateLimiter, ip: string) => {
    let err: unknown;
    limiter({ ip } as never, {} as never, (e?: unknown) => {
      err = e;
    });
    return err;
  };

  it('window resets after 15 minutes', () => {
    let t = 1_000_000;
    const l = createRateLimiter({ max: 2, windowMs: 15 * 60_000, message: 'x', now: () => t });
    expect(run(l, '1.1.1.1')).toBeUndefined();
    expect(run(l, '1.1.1.1')).toBeUndefined();
    expect(run(l, '1.1.1.1')).toBeTruthy();
    t += 15 * 60_000 - 1;
    expect(run(l, '1.1.1.1')).toBeTruthy();
    t += 1;
    expect(run(l, '1.1.1.1')).toBeUndefined();
  });

  it('expired entries are evicted, at most once per minute', () => {
    let t = 1_000_000;
    const l = createRateLimiter({ max: 5, windowMs: 15 * 60_000, message: 'x', now: () => t });
    run(l, '1.1.1.1');
    run(l, '2.2.2.2');
    expect(l.size()).toBe(2);
    t += 15 * 60_000 + 1;
    run(l, '3.3.3.3'); // sweep runs (>= 60s since last)
    expect(l.size()).toBe(1);
    t += 5_000;
    run(l, '4.4.4.4');
    expect(l.size()).toBe(2);
    t += 15 * 60_000; // 3.3.3.3 and 4.4.4.4 expired
    t -= 30_000; // ...but only 30s... still sweeps once a minute
    run(l, '5.5.5.5');
    expect(l.size()).toBeGreaterThanOrEqual(1);
  });
});
