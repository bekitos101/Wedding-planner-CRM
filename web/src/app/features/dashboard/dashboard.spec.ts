import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Dashboard } from '../../core/models/dashboard';
import { Task } from '../../core/models/task';
import { httpTestProviders, makeWedding } from '../weddings/testing';
import { WeddingContext } from '../weddings/wedding-context.service';
import { WeddingAreaComponent } from '../weddings/wedding-area.component';
import { WeddingOverviewPage } from '../weddings/wedding-overview.page';

const task: Task = {
  id: 't1', title: 'Book band', description: null, dueDate: '2026-12-01', priority: 'HIGH', status: 'IN_PROGRESS',
  progressNotes: null, assignee: { id: 'u2', name: 'Tom Team' }, isOverdue: true, completedAt: null, createdAt: '', updatedAt: '',
};

function dash(over: Partial<Dashboard> = {}): Dashboard {
  return {
    wedding: { id: 'w1', coupleNames: 'Anna & Ben', weddingDate: '2027-06-12', location: 'Budapest', status: 'ACTIVE', daysUntilWedding: 205 },
    guests: { total: 20, pending: 5, accepted: 12, declined: 3, responseRate: 75, invitations: { notSent: 4, sent: 14, failed: 2, revoked: 0 } },
    tasks: { total: 10, todo: 3, inProgress: 2, completed: 5, unfinished: 5, overdue: 1, dueNext7Days: 2, percentComplete: 50, myOpenTasks: 2 },
    budget: { totalBudget: '10000.00', committed: '12000.00', paid: '3000.00', outstanding: '9000.00', remaining: '-2000.00', overdueExpenseCount: 1 },
    suppliers: { total: 4 },
    schedule: { items: 6, overlappingItems: 2 },
    upcomingTasks: [task],
    ...over,
  };
}

function render(d: Dashboard | null, role: 'OWNER' | 'TEAM_MEMBER' = 'OWNER') {
  TestBed.configureTestingModule({ imports: [WeddingOverviewPage], providers: [provideRouter([]), ...httpTestProviders()] });
  TestBed.inject(WeddingContext).set(makeWedding({ role }));
  const ctrl = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(WeddingOverviewPage);
  fixture.detectChanges();
  const req = ctrl.expectOne('/api/weddings/w1/dashboard');
  if (d) {
    expect(fixture.nativeElement.querySelector('[data-testid=skeleton]')).not.toBeNull();
    req.flush(d);
  } else {
    req.flush({ error: { code: 'X', message: 'Boom happened.' } }, { status: 500, statusText: 'err' });
  }
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, ctrl, fixture };
}

const empty = () =>
  dash({
    guests: { total: 0, pending: 0, accepted: 0, declined: 0, responseRate: 0, invitations: { notSent: 0, sent: 0, failed: 0, revoked: 0 } },
    tasks: { total: 0, todo: 0, inProgress: 0, completed: 0, unfinished: 0, overdue: 0, dueNext7Days: 0, percentComplete: 0, myOpenTasks: 0 },
    budget: { totalBudget: '0.00', committed: '0.00', paid: '0.00', outstanding: '0.00', remaining: '0.00', overdueExpenseCount: 0 },
    suppliers: { total: 0 },
    schedule: { items: 0, overlappingItems: 0 },
    upcomingTasks: [],
  });

describe('Dashboard on the overview', () => {
  it('FR-57: renders exact numbers, over budget in danger colour, overlap chip, upcoming task', () => {
    const { el } = render(dash());
    const text = (id: string) => el.querySelector(`[data-testid=${id}]`)!.textContent!.replace(/\s+/g, ' ');
    expect(text('countdown')).toContain('in 205 days');
    expect(text('card-guests')).toContain('12 accepted · 3 declined · 5 pending');
    expect(text('card-guests')).toContain('Response rate 75%');
    expect(text('card-tasks')).toContain('5 of 10 done');
    expect(text('card-tasks')).toContain('1 overdue');
    expect(text('card-tasks')).toContain('2 due in the next 7 days');
    expect(text('card-tasks')).toContain('2 assigned to you');
    expect(text('card-budget')).toContain('€12,000.00');
    expect(text('card-budget')).toContain('Paid €3,000.00');
    const rem = el.querySelector('[data-testid=remaining]')!;
    expect(rem.textContent).toContain('Over budget by €2,000.00');
    expect(rem.className).toContain('text-red-800');
    expect(text('card-suppliers')).toContain('4');
    expect(text('card-schedule')).toContain('2 overlapping');
    expect(text('invitations')).toContain('2 failed');
    expect(text('invitations')).toContain('Review failed invitations');
    const row = el.querySelector('[data-testid=upcoming-task]')!;
    expect(row.textContent).toContain('Book band');
    expect(row.textContent).toContain('Overdue');
    expect(row.textContent).toContain('Tom Team');
  });

  it('NFR-12: every chart has a text equivalent with the numbers', () => {
    const { el } = render(dash());
    const charts = Array.from(el.querySelectorAll('[data-testid=chart]'));
    expect(charts.length).toBe(3);
    const labels = charts.map((c) => c.getAttribute('aria-label')!);
    expect(labels[0]).toContain('Accepted 12');
    expect(labels[0]).toContain('Declined 3');
    expect(labels[0]).toContain('Pending 5');
    expect(labels[1]).toContain('Completed 5');
    expect(labels[1]).toContain('In progress 2');
    expect(labels[1]).toContain('To do 3');
    expect(labels[2]).toContain('Paid €3,000.00');
    expect(labels[2]).toContain('Over budget by €2,000.00');
    expect(el.querySelectorAll('[data-testid=legend]').length).toBe(3);
  });

  it('countdown uses present tense for future dates', () => {
    const a = render(dash());
    expect(a.el.querySelector('[data-testid=countdown]')!.textContent).toContain('is in 205 days');
  });

  it('countdown says today for 0 days', () => {
    const a = render(dash({ wedding: { ...dash().wedding, daysUntilWedding: 0 } }));
    expect(a.el.querySelector('[data-testid=countdown]')!.textContent).toContain('today');
  });

  it('countdown says N days ago for negative days', () => {
    const a = render(dash({ wedding: { ...dash().wedding, daysUntilWedding: -3 } }));
    expect(a.el.querySelector('[data-testid=countdown]')!.textContent).toContain('was')
    expect(a.el.querySelector('[data-testid=countdown]')!.textContent).toContain('3 days ago');
  });

  it('empty wedding shows getting-started cards to the owner', () => {
    const owner = render(empty());
    const gs = owner.el.querySelector('[data-testid=getting-started]')!;
    expect(gs.textContent).toContain('Add guests');
    expect(gs.textContent).toContain('Apply a checklist');
    expect(gs.textContent).toContain('Add expenses');
  });

  it('empty wedding does not show getting-started cards to a team member', () => {
    const member = render(empty(), 'TEAM_MEMBER');
    expect(member.el.querySelector('[data-testid=getting-started]')).toBeNull();
    expect(member.el.querySelector('[data-testid=nothing-yet]')).not.toBeNull();
  });

  it('shows an error with retry', () => {
    const { el, ctrl, fixture } = render(null);
    expect(el.textContent).toContain('Boom happened.');
    const retry = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Try again')) as HTMLButtonElement;
    retry.click();
    ctrl.expectOne('/api/weddings/w1/dashboard').flush(dash());
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=countdown]')).not.toBeNull();
  });
});

describe('Reports nav link', () => {
  it('is visible to team members (Team link is not)', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'weddings/:weddingId', component: WeddingAreaComponent }]), ...httpTestProviders()],
    });
    const ctrl = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/weddings/w1');
    ctrl.expectOne('/api/weddings/w1').flush(makeWedding({ role: 'TEAM_MEMBER' }));
    harness.detectChanges();
    const fixture = harness.fixture;
    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('nav a')).map((a) => a.textContent!.trim());
    expect(links).toContain('Reports');
    expect(links).not.toContain('Team');
  });
});
