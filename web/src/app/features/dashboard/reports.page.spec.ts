import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BudgetReport, GuestReport } from '../../core/models/reports';
import { httpTestProviders, makeWedding } from '../weddings/testing';
import { WeddingContext } from '../weddings/wedding-context.service';
import { ReportsPage } from './reports.page';

const guests: GuestReport = {
  summary: { total: 2, pending: 1, accepted: 1, declined: 0, responseRate: 50 },
  dietary: [{ name: 'Amy', rsvpStatus: 'ACCEPTED', dietaryRequirements: 'Vegan' }],
  guests: [
    { name: 'Amy', email: 'amy@x.com', rsvpStatus: 'ACCEPTED', respondedAt: '2026-11-01T10:00:00.000Z', dietaryRequirements: 'Vegan', invitationStatus: 'SENT' },
    { name: 'Bob', email: 'bob@x.com', rsvpStatus: 'PENDING', respondedAt: null, dietaryRequirements: null, invitationStatus: 'FAILED' },
  ],
};
const budget: BudgetReport = {
  totals: { totalBudget: '1000.00', committed: '1200.00', paid: '200.00', outstanding: '1000.00', remaining: '-200.00' },
  byCategory: [
    { category: 'Venue', expenseCount: 1, committed: '800.00', paid: '200.00', outstanding: '600.00', shareOfCommitted: 66 },
    { category: 'Food', expenseCount: 2, committed: '400.00', paid: '0.00', outstanding: '400.00', shareOfCommitted: 33 },
  ],
};

function setup(g: GuestReport, b: BudgetReport) {
  TestBed.configureTestingModule({ imports: [ReportsPage], providers: httpTestProviders() });
  TestBed.inject(WeddingContext).set(makeWedding({ role: 'TEAM_MEMBER' }));
  const ctrl = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ReportsPage);
  fixture.detectChanges();
  ctrl.expectOne('/api/weddings/w1/reports/guests').flush(g);
  ctrl.expectOne('/api/weddings/w1/reports/budget').flush(b);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ReportsPage', () => {
  it('FR-58: renders dietary table, guest table and category rows', () => {
    const el = setup(guests, budget);
    expect(el.querySelector('[data-testid=dietary-table]')!.textContent).toContain('Vegan');
    expect(el.querySelectorAll('[data-testid=guest-table] tbody tr').length).toBe(2);
    expect(el.querySelector('[data-testid=guest-table]')!.textContent).toContain('Failed');
    const rows = el.querySelectorAll('[data-testid=category-row]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Venue');
    expect(rows[0].textContent).toContain('€800.00');
    expect(rows[0].textContent).toContain('66%');
    expect(el.querySelector('[data-testid=remaining]')!.textContent).toContain('Over budget by €200.00');
  });

  it('shows empty states', () => {
    const el = setup(
      { ...guests, dietary: [], guests: [] },
      { totals: { ...budget.totals, remaining: '1000.00' }, byCategory: [] },
    );
    expect(el.querySelector('[data-testid=no-dietary]')).not.toBeNull();
    expect(el.querySelector('[data-testid=no-categories]')).not.toBeNull();
  });
});
