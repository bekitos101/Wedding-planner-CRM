import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TeamPage } from './team.page';
import { WeddingContext } from './wedding-context.service';
import { httpTestProviders, makeWedding } from './testing';

describe('TeamPage', () => {
  const member = {
    userId: 'u2', name: 'Tom Team', email: 'tom@example.com', role: 'TEAM_MEMBER' as const,
    status: 'ACTIVE' as const, addedAt: '2026-02-01T00:00:00.000Z', revokedAt: null,
  };

  function setup() {
    TestBed.configureTestingModule({ imports: [TeamPage], providers: httpTestProviders() });
    TestBed.inject(WeddingContext).set(makeWedding());
    const ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TeamPage);
    fixture.detectChanges();
    ctrl.expectOne('/api/weddings/w1/members').flush([member]);
    fixture.detectChanges();
    return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
  }

  it('lists members with a status chip', () => {
    const { el } = setup();
    expect(el.textContent).toContain('Tom Team');
    expect(el.textContent).toContain('Active');
  });

  it('shows the server email field error', () => {
    const { fixture, ctrl, el } = setup();
    fixture.componentInstance.form.setValue({ email: 'ghost@example.com' });
    fixture.componentInstance.add();
    ctrl.expectOne('/api/weddings/w1/members').flush(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No registered planner with this email.',
          fields: { email: 'No registered planner with this email.' },
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    const field = el.querySelector('#memberEmail')!.closest('.field')!;
    expect(field.querySelector('.field-error')?.textContent).toContain('No registered planner with this email.');
  });

  it('revokes after confirmation and reloads', () => {
    const { fixture, ctrl } = setup();
    fixture.componentInstance.toRevoke.set(member);
    fixture.componentInstance.revoke(member);
    ctrl.expectOne('/api/weddings/w1/members/u2').flush(null, { status: 204, statusText: 'No Content' });
    ctrl.expectOne('/api/weddings/w1/members').flush([{ ...member, status: 'REVOKED' }]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Revoked');
  });

  it('archived wedding: hides Add team member but still shows Revoke', () => {
    TestBed.configureTestingModule({ imports: [TeamPage], providers: httpTestProviders() });
    TestBed.inject(WeddingContext).set(makeWedding({ status: 'ARCHIVED' }));
    const ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(TeamPage);
    fixture.detectChanges();
    ctrl.expectOne('/api/weddings/w1/members').flush([member]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Add team member');
    expect(el.querySelector('#memberEmail')).toBeNull();
    expect(el.textContent).toContain('Revoke');
    expect(el.textContent).toContain('you can still revoke access');
  });

  it('shows a 409 archived message in an alert', () => {
    const { fixture, ctrl, el } = setup();
    fixture.componentInstance.form.setValue({ email: 'x@example.com' });
    fixture.componentInstance.add();
    ctrl.expectOne('/api/weddings/w1/members').flush(
      { error: { code: 'CONFLICT', message: "This wedding is archived and can't be changed." } },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(el.querySelector('.alert-danger')?.textContent).toContain('archived');
  });
});
