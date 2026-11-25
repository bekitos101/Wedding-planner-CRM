import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { invitationRepository } from '../src/repositories/invitationRepository.js';
import { friendlyMailError } from '../src/services/invitationService.js';
import { createApp } from '../src/app.js';
import { setMailTransportForTests } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createGuest, createUser, createWedding } from './helpers/factories.js';
import { createWeddingWithPastDeadline, tokenFromMail } from './helpers/guestFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);

interface Sent {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
let sent: Sent[] = [];
let failWith: string | null = null;
function installMail() {
  sent = [];
  failWith = null;
  setMailTransportForTests({
    async sendMail(m) {
      if (failWith) throw new Error(failWith);
      sent.push({ to: m.to, subject: m.subject, text: m.text, html: m.html });
      return { messageId: 'test' };
    },
  });
}
afterEach(() => setMailTransportForTests(undefined));

async function setup(past = false) {
  installMail();
  const { user: owner } = await createUser();
  const wedding = past ? await createWeddingWithPastDeadline(owner.id) : await createWedding(owner.id, { coupleNames: 'Anna & <Ben>' });
  const guest = await createGuest(wedding.id, { name: 'Gina <b>Guest</b>', email: 'gina@test.local' });
  return { owner, wedding, guest, h: bearer(owner.id) };
}
const sendUrl = (w: string, g: string) => `/api/weddings/${w}/guests/${g}/invitation/send`;
const revokeUrl = (w: string, g: string) => `/api/weddings/${w}/guests/${g}/invitation/revoke`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('invitations (FR-22..24, FR-29)', () => {
  it('AC-05: planner adds a guest, sends an invitation and sees its delivery status', async () => {
    installMail();
    const { user: owner } = await createUser();
    const wedding = await createWedding(owner.id);
    const h = bearer(owner.id);
    const created = await api().post(`/api/weddings/${wedding.id}/guests`).set(h).send({ name: 'Eve', email: 'eve@test.local' });
    expect(created.status).toBe(201);
    expect(created.body.invitation).toBeNull();

    const res = await api().post(sendUrl(wedding.id, created.body.id)).set(h);
    expect(res.status).toBe(200);
    expect(res.body.invitation).toMatchObject({ status: 'SENT', deliveryStatus: 'SENT', attemptCount: 1, lastError: null, revokedAt: null, lastSentAt: expect.any(String) });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('eve@test.local');
    expect(sent[0]!.subject).toBe("You're invited: Anna & Ben");
    expect(sent[0]!.text).toContain('/rsvp/');

    const list = await api().get(`/api/weddings/${wedding.id}/guests`).set(h);
    expect(list.body.guests[0].invitation.status).toBe('SENT');
    expect(JSON.stringify(res.body) + JSON.stringify(list.body)).not.toMatch(/tokenHash|"token"/);
  });

  it('BR-05: resend rotates the token, keeps one invitation, old link stops working', async () => {
    const { wedding, guest, h } = await setup();
    await api().post(sendUrl(wedding.id, guest.id)).set(h);
    const first = tokenFromMail(sent[0]!.text);
    expect((await api().get(`/api/rsvp/${first}`)).status).toBe(200);

    const again = await api().post(sendUrl(wedding.id, guest.id)).set(h);
    expect(again.status).toBe(200);
    expect(again.body.invitation.attemptCount).toBe(1); // a manual send resets the counter
    const second = tokenFromMail(sent[1]!.text);
    expect(second).not.toBe(first);
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(1);
    expect(await prisma.guest.count({ where: { weddingId: wedding.id } })).toBe(1);
    expect((await api().get(`/api/rsvp/${first}`)).status).toBe(404);
    expect((await api().get(`/api/rsvp/${second}`)).status).toBe(200);
  });

  it('BR-05: resending after a revoke makes a fresh working link', async () => {
    const { wedding, guest, h } = await setup();
    await api().post(sendUrl(wedding.id, guest.id)).set(h);
    expect((await api().post(revokeUrl(wedding.id, guest.id)).set(h)).body.invitation.status).toBe('REVOKED');
    const res = await api().post(sendUrl(wedding.id, guest.id)).set(h);
    expect(res.body.invitation).toMatchObject({ status: 'SENT', revokedAt: null });
    expect((await api().get(`/api/rsvp/${tokenFromMail(sent[1]!.text)}`)).status).toBe(200);
  });

  it('NFR-03: only the SHA-256 hash is stored (token is 32 random bytes, base64url)', async () => {
    const { wedding, guest, h } = await setup();
    await api().post(sendUrl(wedding.id, guest.id)).set(h);
    const token = tokenFromMail(sent[0]!.text);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const inv = await prisma.invitation.findUniqueOrThrow({ where: { guestId: guest.id } });
    expect(inv.tokenHash).toBe(sha(token));
    expect(JSON.stringify(inv)).not.toContain(token);
  });

  it('FR-24: email has couple, date, location and link; user data is HTML-escaped; subject has no link', async () => {
    const { wedding, guest, h } = await setup();
    await api().post(sendUrl(wedding.id, guest.id)).set(h);
    const m = sent[0]!;
    expect(m.html).toContain('Anna &amp; &lt;Ben&gt;');
    expect(m.html).toContain('Gina &lt;b&gt;Guest&lt;/b&gt;');
    expect(m.html).not.toContain('<b>Guest</b>');
    expect(m.text).toContain('Budapest');
    expect(m.subject).not.toContain('/rsvp/');
    expect(m.subject).not.toContain(tokenFromMail(m.text));
  });

  it('NFR-17/BR-11: mail failure records FAILED and still returns 200', async () => {
    const { wedding, guest, h } = await setup();
    failWith = 'connect ECONNREFUSED 127.0.0.1:1025';
    const res = await api().post(sendUrl(wedding.id, guest.id)).set(h);
    expect(res.status).toBe(200);
    expect(res.body.invitation).toMatchObject({ status: 'FAILED', deliveryStatus: 'FAILED', attemptCount: 1, lastSentAt: null });
    expect(res.body.invitation.lastError).toBe('The email server could not be reached.');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(await prisma.guest.count({ where: { weddingId: wedding.id } })).toBe(1);

    // retry succeeds on the same single invitation
    failWith = null;
    const retry = await api().post(sendUrl(wedding.id, guest.id)).set(h);
    expect(retry.body.invitation).toMatchObject({ status: 'SENT', lastError: null });
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(1);
  });

  it('NFR-10: transport errors map to friendly planner messages', () => {
    expect(friendlyMailError('connect ETIMEDOUT 1.2.3.4:25')).toBe('The email server did not respond in time.');
    expect(friendlyMailError('Invalid login: 535 Authentication failed')).toBe('The email server rejected our login.');
    expect(friendlyMailError('something odd')).toBe('The email could not be delivered.');
  });

  it('NFR-04: guest deleted between lookup and write → 404, not 500', async () => {
    const { wedding, guest, h } = await setup();
    const orig = invitationRepository.upsertForSend.bind(invitationRepository);
    const spy = vi.spyOn(invitationRepository, 'upsertForSend').mockImplementationOnce(async (gid, hash) => {
      await prisma.guest.delete({ where: { id: gid } });
      return orig(gid, hash);
    });
    const res = await api().post(sendUrl(wedding.id, guest.id)).set(h);
    spy.mockRestore();
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Guest not found.');
    expect(sent).toHaveLength(0);
  });

  it('BR-06: sending after the RSVP deadline → 409', async () => {
    const { wedding, guest, h } = await setup(true);
    const res = await api().post(sendUrl(wedding.id, guest.id)).set(h);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('The RSVP deadline for this wedding has passed.');
    expect(sent).toHaveLength(0);
    expect(await prisma.invitation.count({ where: { guestId: guest.id } })).toBe(0);
  });

  it('FR-22: revoking a guest without an invitation → 404 "Invitation not found."', async () => {
    const { wedding, guest, h } = await setup();
    const res = await api().post(revokeUrl(wedding.id, guest.id)).set(h);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Invitation not found.');
  });

  it('BR-13: sending on an archived wedding → 409', async () => {
    const { wedding, guest, h } = await setup();
    await api().post(`/api/weddings/${wedding.id}/archive`).set(h);
    expect((await api().post(sendUrl(wedding.id, guest.id)).set(h)).status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it('NFR-06: the token never appears in logs (send, GET, POST, errors)', async () => {
    const { wedding, guest, h } = await setup();
    let out = '';
    const stream = new Writable({
      write(chunk, _e, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const log = pino({ level: 'debug' }, stream);
    const app = createApp(log);
    await request(app).post(sendUrl(wedding.id, guest.id)).set(h);
    const token = tokenFromMail(sent[0]!.text);
    await request(app).get(`/api/rsvp/${token}`);
    await request(app).post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' });
    await request(app).post(revokeUrl(wedding.id, guest.id)).set(h);
    const gone = await request(app).get(`/api/rsvp/${token}?x=1`);
    expect(gone.status).toBe(410);
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain(token);
    expect(JSON.stringify(gone.body)).not.toContain(token);

    // a failing send logs recipient/subject only, never the link
    out = '';
    failWith = 'smtp down';
    await request(app).post(sendUrl(wedding.id, guest.id)).set(h);
    expect(out).toContain('Email delivery failed');
    expect(out).not.toMatch(/\/rsvp\/[A-Za-z0-9_-]{20,}/);
  });
});
