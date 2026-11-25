import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RsvpView } from '../core/models/guest';
import { httpTestProviders } from '../features/weddings/testing';
import { RsvpPageComponent } from './rsvp-page.component';

const view = (over: Partial<RsvpView> = {}): RsvpView => ({
  guestName: 'Gina Guest', coupleNames: 'Anna & Ben', weddingDate: '2027-06-12', location: 'Budapest',
  rsvpDeadline: '2027-05-01', rsvpStatus: 'PENDING', dietaryRequirements: null, ...over,
});

function setup(token: string | null = 'tok-123') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...httpTestProviders(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(token ? { token } : {}) } } },
    ],
  });
  const ctrl = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(RsvpPageComponent);
  fixture.detectChanges();
  return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
}
const err = (status: number, code: string, message: string) => [
  { error: { code, message } },
  { status, statusText: code },
] as const;

describe('RsvpPageComponent', () => {
  it('has no planner navigation and only the copyright footer (FR-30)', () => {
    const { ctrl, fixture, el } = setup('tok-123');
    ctrl.expectOne('/api/rsvp/tok-123').flush(view());
    fixture.detectChanges();
    expect(el.querySelector('nav')).toBeNull();
    expect(el.querySelector('a')).toBeNull();
    const text = (el.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain(`© ${new Date().getFullYear()} Wedding Organizer. All rights reserved.`);
  });

  it('shows the invitation and the current answer', () => {
    const { ctrl, fixture, el } = setup();
    ctrl.expectOne('/api/rsvp/tok-123').flush(view({ rsvpStatus: 'ACCEPTED' }));
    fixture.detectChanges();
    const text = el.textContent ?? '';
    expect(text).toContain('Anna & Ben');
    expect(text).toContain('Gina Guest');
    expect(text).toContain('Budapest');
    expect(text).toContain('12 Jun 2027');
    expect(text).toContain('Accepted');
  });

  it('404 shows the invalid-link message', () => {
    const { ctrl, fixture, el } = setup();
    ctrl.expectOne('/api/rsvp/tok-123').flush(...err(404, 'NOT_FOUND', 'This invitation link is not valid.'));
    fixture.detectChanges();
    expect(el.textContent).toContain('This invitation link is not valid.');
    expect(el.querySelectorAll('button').length).toBe(0);
  });

  it('410 shows the server message (revoked or deadline passed)', () => {
    const { ctrl, fixture, el } = setup();
    ctrl.expectOne('/api/rsvp/tok-123').flush(...err(410, 'RSVP_CLOSED', 'The RSVP deadline has passed.'));
    fixture.detectChanges();
    expect(el.textContent).toContain('The RSVP deadline has passed.');
    expect(el.querySelectorAll('button').length).toBe(0);
  });

  it('a missing token is invalid without calling the API', () => {
    const { ctrl, el } = setup(null);
    ctrl.expectNone(() => true);
    expect(el.textContent).toContain('This invitation link is not valid.');
  });

  it('posts the answer with dietary requirements and shows the updated answer', () => {
    const { fixture, ctrl, el } = setup();
    ctrl.expectOne('/api/rsvp/tok-123').flush(view());
    fixture.detectChanges();
    const diet = el.querySelector('#rsvpDiet') as HTMLTextAreaElement;
    diet.value = 'Vegan';
    diet.dispatchEvent(new Event('input'));
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('be there')) as HTMLButtonElement).click();
    const req = ctrl.expectOne('/api/rsvp/tok-123');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ rsvpStatus: 'ACCEPTED', dietaryRequirements: 'Vegan' });
    req.flush(view({ rsvpStatus: 'ACCEPTED', dietaryRequirements: 'Vegan' }));
    fixture.detectChanges();
    expect(el.querySelector('.alert-success')?.textContent).toContain('Your answer has been saved');
    expect(el.textContent).toContain('Accepted');
    // can change again
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent?.includes("can't come"))).toBe(true);
  });

  it('a 410 while submitting switches to the closed card', () => {
    const { fixture, ctrl, el } = setup();
    ctrl.expectOne('/api/rsvp/tok-123').flush(view());
    fixture.detectChanges();
    fixture.componentInstance.answer('DECLINED');
    ctrl.expectOne('/api/rsvp/tok-123').flush(...err(410, 'RSVP_CLOSED', 'This invitation is no longer valid.'));
    fixture.detectChanges();
    expect(el.textContent).toContain('This invitation is no longer valid.');
  });
});
