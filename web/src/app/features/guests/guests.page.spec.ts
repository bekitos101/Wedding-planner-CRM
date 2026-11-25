import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Guest } from '../../core/models/guest';
import { httpTestProviders, makeWedding } from '../weddings/testing';
import { WeddingContext } from '../weddings/wedding-context.service';
import { GuestsPage } from './guests.page';
import { invitationChip } from './invitation-status';

const inv = (over: object = {}) => ({
  status: 'SENT' as const, deliveryStatus: 'SENT', attemptCount: 1, lastSentAt: '2026-05-01T10:00:00.000Z',
  lastError: null, revokedAt: null, ...over,
});
const guest = (over: Partial<Guest> = {}): Guest => ({
  id: 'g1', name: 'Gina Guest', email: 'gina@example.com', rsvpStatus: 'PENDING', dietaryRequirements: 'Vegan',
  respondedAt: null, createdAt: '2026-01-01T00:00:00.000Z', invitation: null, ...over,
});
const summary = { total: 3, pending: 1, accepted: 1, declined: 1 };

function setup(guests: Guest[]) {
  TestBed.configureTestingModule({ imports: [GuestsPage], providers: httpTestProviders() });
  TestBed.inject(WeddingContext).set(makeWedding());
  const ctrl = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(GuestsPage);
  fixture.detectChanges();
  ctrl.expectOne((r) => r.url === '/api/weddings/w1/guests').flush({ guests, summary });
  fixture.detectChanges();
  return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
}
const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

describe('invitationChip', () => {
  it('maps invitation summaries to chips', () => {
    expect(invitationChip(null).label).toBe('Not sent');
    expect(invitationChip(inv()).label).toBe('Sent');
    expect(invitationChip(inv({ status: 'REVOKED' })).label).toBe('Revoked');
    const failed = invitationChip(inv({ status: 'FAILED', lastError: 'SMTP down' }));
    expect(failed.label).toBe('Failed');
    expect(failed.detail).toBe('SMTP down');
  });
});

describe('GuestsPage', () => {
  it('shows summary chips, RSVP chip, dietary notes and invitation status', () => {
    const { el } = setup([guest({ invitation: inv({ status: 'FAILED', lastError: 'SMTP down' }) })]);
    const text = el.textContent ?? '';
    expect(text).toContain('3 total');
    expect(text).toContain('1 accepted');
    expect(text).toContain('Pending');
    expect(text).toContain('Vegan');
    expect(text).toContain('Failed');
    expect(text).toContain('SMTP down');
  });

  it('sends a first invitation straight away', () => {
    const { fixture, ctrl, el } = setup([guest()]);
    button(el, 'Send invitation').click();
    const req = ctrl.expectOne('/api/weddings/w1/guests/g1/invitation/send');
    expect(req.request.method).toBe('POST');
    req.flush(guest({ invitation: inv() }));
    ctrl.expectOne((r) => r.url === '/api/weddings/w1/guests').flush({ guests: [guest({ invitation: inv() })], summary });
    fixture.detectChanges();
    expect(el.querySelector('.alert-success')?.textContent).toContain('Invitation sent');
  });

  it('resend asks for confirmation, then shows a warning when delivery FAILED', () => {
    const { fixture, ctrl, el } = setup([guest({ invitation: inv() })]);
    button(el, 'Resend').click();
    fixture.detectChanges();
    expect(el.querySelector('app-confirm-dialog')?.textContent).toContain('The previous link will stop working');
    ctrl.expectNone('/api/weddings/w1/guests/g1/invitation/send');

    (el.querySelector('app-confirm-dialog .btn-danger') as HTMLButtonElement).click();
    const failed = guest({ invitation: inv({ status: 'FAILED', lastError: 'Mailbox unavailable' }) });
    ctrl.expectOne('/api/weddings/w1/guests/g1/invitation/send').flush(failed);
    ctrl.expectOne((r) => r.url === '/api/weddings/w1/guests').flush({ guests: [failed], summary });
    fixture.detectChanges();
    const warning = el.querySelector('.alert-warning');
    expect(warning?.textContent).toContain('could not be delivered');
    expect(warning?.textContent).toContain('Mailbox unavailable');
    expect(el.querySelector('.alert-danger')).toBeNull();
  });

  it('revokes a link after confirmation', () => {
    const { fixture, ctrl, el } = setup([guest({ invitation: inv() })]);
    button(el, 'Revoke link').click();
    fixture.detectChanges();
    (el.querySelector('app-confirm-dialog .btn-danger') as HTMLButtonElement).click();
    ctrl.expectOne('/api/weddings/w1/guests/g1/invitation/revoke').flush(guest({ invitation: inv({ status: 'REVOKED' }) }));
    ctrl.expectOne((r) => r.url === '/api/weddings/w1/guests').flush({ guests: [], summary });
    fixture.detectChanges();
    expect(el.textContent).toContain('revoked');
  });

  it('sends search and rsvpStatus as query params', () => {
    const { fixture, ctrl } = setup([guest()]);
    fixture.componentInstance.rsvp.set('ACCEPTED');
    fixture.componentInstance.load();
    const req = ctrl.expectOne((r) => r.url === '/api/weddings/w1/guests');
    expect(req.request.params.get('rsvpStatus')).toBe('ACCEPTED');
    req.flush({ guests: [], summary });
  });

  it('hides write actions for team members', () => {
    TestBed.configureTestingModule({ imports: [GuestsPage], providers: httpTestProviders() });
    TestBed.inject(WeddingContext).set(makeWedding({ role: 'TEAM_MEMBER' }));
    const ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(GuestsPage);
    fixture.detectChanges();
    ctrl.expectOne((r) => r.url === '/api/weddings/w1/guests').flush({ guests: [guest()], summary });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(button(el, 'Add guest')).toBeUndefined();
    expect(button(el, 'Send invitation')).toBeUndefined();
    expect(button(el, 'Delete')).toBeUndefined();
  });

  it('FR-28: editing only the name sends {name} without rsvpStatus', () => {
    const { fixture, ctrl, el } = setup([guest()]);
    button(el, 'Edit').click();
    fixture.detectChanges();
    const name = el.querySelector('#guestName') as HTMLInputElement;
    name.value = 'Gina G.';
    name.dispatchEvent(new Event('input'));
    (el.querySelector('app-guest-form form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = ctrl.expectOne('/api/weddings/w1/guests/g1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Gina G.' });
  });

  it('an edit with no changes closes without a request', () => {
    const { fixture, ctrl, el } = setup([guest()]);
    button(el, 'Edit').click();
    fixture.detectChanges();
    (el.querySelector('app-guest-form form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    ctrl.expectNone('/api/weddings/w1/guests/g1');
    fixture.detectChanges();
    expect(el.querySelector('app-guest-form')).toBeNull();
  });

  it('ignores a slow older list response that arrives after a newer one', () => {
    const { fixture, ctrl } = setup([guest()]);
    const page = fixture.componentInstance;
    page.rsvp.set('ACCEPTED');
    page.load();
    page.rsvp.set('DECLINED');
    page.load();
    const [older, newer] = ctrl.match((r) => r.url === '/api/weddings/w1/guests');
    newer.flush({ guests: [guest({ id: 'g9', name: 'Newer' })], summary });
    older.flush({ guests: [guest({ id: 'g8', name: 'Older' })], summary });
    expect(page.guests().map((x) => x.name)).toEqual(['Newer']);
  });
});
