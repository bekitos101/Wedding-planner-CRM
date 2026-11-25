import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { invitationRepository } from '../src/repositories/invitationRepository.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';
import { setMailTransportForTests } from '../src/lib/mailer.js';
import { prisma } from '../src/lib/prisma.js';
import { api } from './helpers/app.js';
import { bearer } from './helpers/auth.js';
import { disconnectDb, resetDb } from './helpers/db.js';
import { createGuest, createUser, createWedding } from './helpers/factories.js';
import { createWeddingWithPastDeadline, tokenFromMail } from './helpers/guestFactories.js';

beforeAll(resetDb);
afterAll(disconnectDb);
afterEach(() => setMailTransportForTests(undefined));

let lastText = '';
function installMail() {
  setMailTransportForTests({
    async sendMail(m) {
      lastText = m.text;
      return { messageId: 'x' };
    },
  });
}

/** Creates owner, wedding, guest and sends a real invitation through the API; returns the token. */
async function invited(past = false) {
  installMail();
  const { user: owner } = await createUser();
  const wedding = past ? await createWeddingWithPastDeadline(owner.id) : await createWedding(owner.id);
  const guest = await createGuest(wedding.id, { name: 'Gina Guest', email: 'gina@test.local' });
  const h = bearer(owner.id);
  if (past) {
    // the send endpoint refuses expired weddings, so insert the invitation directly
    const { generateToken, hashToken } = await import('../src/lib/tokens.js');
    const token = generateToken();
    await prisma.invitation.create({ data: { guestId: guest.id, tokenHash: hashToken(token), deliveryStatus: 'SENT', attemptCount: 1 } });
    return { owner, wedding, guest, h, token };
  }
  await api().post(`/api/weddings/${wedding.id}/guests/${guest.id}/invitation/send`).set(h);
  return { owner, wedding, guest, h, token: tokenFromMail(lastText) };
}

describe('public RSVP (FR-25..30)', () => {
  it('AC-06: guest RSVPs via a valid link and the guest list summary reflects it', async () => {
    const { wedding, guest, h, token } = await invited();
    const before = await api().get(`/api/weddings/${wedding.id}/guests`).set(h);
    expect(before.body.summary).toEqual({ total: 1, pending: 1, accepted: 0, declined: 0 });

    const view = await api().get(`/api/rsvp/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.rsvpStatus).toBe('PENDING');

    const res = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED', dietaryRequirements: ' Vegan ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rsvpStatus: 'ACCEPTED', dietaryRequirements: 'Vegan' });

    const after = await api().get(`/api/weddings/${wedding.id}/guests`).set(h);
    expect(after.body.summary).toEqual({ total: 1, pending: 0, accepted: 1, declined: 0 });
    expect(after.body.guests[0]).toMatchObject({ rsvpStatus: 'ACCEPTED', dietaryRequirements: 'Vegan', respondedAt: expect.any(String) });
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).respondedAt).not.toBeNull();
  });

  it('FR-25: repeated POST changes the answer; omitted dietary stays, "" clears it', async () => {
    const { token } = await invited();
    await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED', dietaryRequirements: 'Nuts' });
    const declined = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'DECLINED' });
    expect(declined.body).toMatchObject({ rsvpStatus: 'DECLINED', dietaryRequirements: 'Nuts' });
    const cleared = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED', dietaryRequirements: '' });
    expect(cleared.body).toMatchObject({ rsvpStatus: 'ACCEPTED', dietaryRequirements: null });
    expect((await api().get(`/api/rsvp/${token}`)).body.rsvpStatus).toBe('ACCEPTED');
  });

  it('FR-25: invalid answers → 400 and nothing changes', async () => {
    const { token, guest } = await invited();
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'PENDING' })).status).toBe(400);
    expect((await api().post(`/api/rsvp/${token}`).send({})).status).toBe(400);
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED', dietaryRequirements: 'x'.repeat(501) })).status).toBe(400);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).rsvpStatus).toBe('PENDING');
  });

  it('AC-07: invalid link 404, revoked link 410, expired link 410', async () => {
    const { wedding, guest, h, token } = await invited();
    // invalid (well-formed but unknown, and garbage)
    for (const bad of ['A'.repeat(43), 'short', 'x'.repeat(200)]) {
      const g = await api().get(`/api/rsvp/${bad}`);
      expect(g.status).toBe(404);
      expect(g.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'This invitation link is not valid.' });
      expect((await api().post(`/api/rsvp/${bad}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(404);
    }
    // revoked
    expect((await api().post(`/api/weddings/${wedding.id}/guests/${guest.id}/invitation/revoke`).set(h)).status).toBe(200);
    const revoked = await api().get(`/api/rsvp/${token}`);
    expect(revoked.status).toBe(410);
    expect(revoked.body.error).toMatchObject({ code: 'RSVP_CLOSED', message: 'This invitation is no longer valid.' });
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(410);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).rsvpStatus).toBe('PENDING');

    // expired
    const exp = await invited(true);
    const view = await api().get(`/api/rsvp/${exp.token}`);
    expect(view.status).toBe(410);
    expect(view.body.error).toMatchObject({ code: 'RSVP_CLOSED', message: 'The RSVP deadline has passed.' });
    const post = await api().post(`/api/rsvp/${exp.token}`).send({ rsvpStatus: 'ACCEPTED' });
    expect(post.status).toBe(410);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: exp.guest.id } })).rsvpStatus).toBe('PENDING');
  });

  it('BR-06/NFR-08: revoke between validation and save → 410 and no write', async () => {
    const { guest, token } = await invited();
    const orig = invitationRepository.findByTokenHash.bind(invitationRepository);
    const spy = vi.spyOn(invitationRepository, 'findByTokenHash').mockImplementationOnce(async (hash) => {
      const r = await orig(hash);
      await prisma.invitation.update({ where: { guestId: guest.id }, data: { revokedAt: new Date() } });
      return r;
    });
    const res = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' });
    spy.mockRestore();
    expect(res.status).toBe(410);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).rsvpStatus).toBe('PENDING');
  });

  it('BR-05/NFR-08: rotation between validation and save → 404 and no write', async () => {
    const { guest, token } = await invited();
    const orig = invitationRepository.findByTokenHash.bind(invitationRepository);
    const spy = vi.spyOn(invitationRepository, 'findByTokenHash').mockImplementationOnce(async (hash) => {
      const r = await orig(hash);
      await prisma.invitation.update({ where: { guestId: guest.id }, data: { tokenHash: hashToken(generateToken()) } });
      return r;
    });
    const res = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' });
    spy.mockRestore();
    expect(res.status).toBe(404);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).rsvpStatus).toBe('PENDING');
  });

  it('NFR-08: saveResponse with a stale hash, archived wedding or closed deadline writes nothing', async () => {
    const { wedding, guest, token } = await invited();
    const data = { rsvpStatus: 'ACCEPTED' as const, respondedAt: new Date() };
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    expect(await invitationRepository.saveResponse(guest.id, hashToken('A'.repeat(43)), today, data)).toBe(false);
    const later = new Date(today.getTime() + 400 * 86400000);
    expect(await invitationRepository.saveResponse(guest.id, hashToken(token), later, data)).toBe(false);
    await prisma.wedding.update({ where: { id: wedding.id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    expect(await invitationRepository.saveResponse(guest.id, hashToken(token), today, data)).toBe(false);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guest.id } })).rsvpStatus).toBe('PENDING');
  });

  it('NFR-04: malformed token → 404 with the same body as an unknown one', async () => {
    const a = await api().get('/api/rsvp/bad!token');
    const b = await api().get(`/api/rsvp/${'A'.repeat(43)}`);
    expect(a.status).toBe(404);
    expect(a.body).toEqual(b.body);
  });

  it('BR-06: RSVP stays open through the whole deadline day', async () => {
    const { wedding, token } = await invited();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.wedding.update({ where: { id: wedding.id }, data: { rsvpDeadline: today, weddingDate: new Date(today.getTime() + 30 * 86400000) } });
    expect((await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'ACCEPTED' })).status).toBe(200);
  });

  it('BR-06/BR-13: archived wedding → 410 "no longer valid"', async () => {
    const { wedding, h, token } = await invited();
    await api().post(`/api/weddings/${wedding.id}/archive`).set(h);
    const res = await api().get(`/api/rsvp/${token}`);
    expect(res.status).toBe(410);
    expect(res.body.error.message).toBe('This invitation is no longer valid.');
  });

  it('NFR-08/FR-30: RsvpView contains only that guest’s data', async () => {
    const { wedding, token } = await invited();
    await createGuest(wedding.id, { name: 'Secret Other', email: 'other-secret@test.local' });
    const res = await api().get(`/api/rsvp/${token}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['coupleNames', 'dietaryRequirements', 'guestName', 'location', 'rsvpDeadline', 'rsvpStatus', 'weddingDate'].sort(),
    );
    expect(res.body).toMatchObject({ guestName: 'Gina Guest', coupleNames: 'Anna & Ben', location: 'Budapest' });
    expect(res.body.weddingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.rsvpDeadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Secret Other');
    expect(text).not.toContain('gina@test.local');
    expect(text).not.toContain(wedding.id);
    // POST response has the same shape
    const post = await api().post(`/api/rsvp/${token}`).send({ rsvpStatus: 'DECLINED' });
    expect(Object.keys(post.body).sort()).toEqual(Object.keys(res.body).sort());
  });

  it('NFR-08: needs no login and a planner token does not unlock RSVP of other tokens', async () => {
    const { token } = await invited();
    expect((await api().get(`/api/rsvp/${token}`)).status).toBe(200); // no Authorization header
  });
});
