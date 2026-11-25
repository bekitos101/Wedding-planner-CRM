import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BudgetSummary, Expense } from '../../core/models/budget';
import { httpTestProviders, makeWedding } from '../weddings/testing';
import { WeddingContext } from '../weddings/wedding-context.service';
import { BudgetPage } from './budget.page';
import { ExpenseDetailPage } from './expense-detail.page';

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', description: 'Venue hire', category: 'Venue', agreedAmount: '1000.00', dueDate: '2027-01-10', notes: null,
  totalPaid: '400.00', outstanding: '600.00', isOverdue: false, paymentCount: 1, createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const summary = (over: Partial<BudgetSummary> = {}): BudgetSummary => ({
  totalBudget: '5000.00', committed: '1000.00', paid: '400.00', outstanding: '600.00', remaining: '4000.00',
  overdueExpenses: [], ...over,
});

describe('BudgetPage', () => {
  function setup(s: BudgetSummary, list: Expense[] = [expense()]) {
    TestBed.configureTestingModule({ imports: [BudgetPage], providers: [provideRouter([]), ...httpTestProviders()] });
    TestBed.inject(WeddingContext).set(makeWedding());
    const ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(BudgetPage);
    fixture.detectChanges();
    ctrl.expectOne('/api/weddings/w1/expenses').flush(list);
    ctrl.expectOne('/api/weddings/w1/budget').flush(s);
    fixture.detectChanges();
    return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
  }

  it('renders the summary cards and expense rows', () => {
    const { el } = setup(summary());
    expect(el.querySelector('[data-testid=remaining]')?.textContent).toContain('€4,000.00');
    expect(el.textContent).toContain('Venue hire');
    expect(el.textContent).toContain('€600.00');
  });

  it('shows negative remaining as over budget', () => {
    const { el } = setup(summary({ committed: '6000.00', remaining: '-1000.00' }));
    expect(el.querySelector('[data-testid=remaining]')?.textContent).toContain('Over budget by €1,000.00');
    expect(el.querySelector('[data-testid=remaining]')?.className).toContain('text-red-800');
  });

  it('lists overdue expenses in an alert and flags the row', () => {
    const { el } = setup(
      summary({ overdueExpenses: [{ id: 'e1', description: 'Venue hire', category: 'Venue', outstanding: '600.00', dueDate: '2027-01-10' }] }),
      [expense({ isOverdue: true })],
    );
    expect(el.querySelector('[data-testid=overdue-alert]')?.textContent).toContain('Venue hire');
    expect(el.querySelector('[data-testid=expense-row]')?.textContent).toContain('Overdue');
  });
});

describe('ExpenseDetailPage', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [ExpenseDetailPage],
      providers: [
        provideRouter([]),
        ...httpTestProviders(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ expenseId: 'e1' }) } } },
      ],
    });
    TestBed.inject(WeddingContext).set(makeWedding());
    const ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ExpenseDetailPage);
    fixture.detectChanges();
    ctrl.expectOne('/api/weddings/w1/expenses/e1').flush(
      expense({ payments: [{ id: 'p1', amount: '400.00', paymentDate: '2026-02-01', notes: 'Deposit', createdAt: '' }] }),
    );
    ctrl.expectOne('/api/weddings/w1/budget').flush(summary());
    fixture.detectChanges();
    return { fixture, ctrl, el: fixture.nativeElement as HTMLElement };
  }

  it('lists payments', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid=payment-row]')?.textContent).toContain('Deposit');
  });

  it('shows an overpayment error under the amount field', () => {
    const { fixture, ctrl, el } = setup();
    fixture.componentInstance.form.setValue({ amount: '900.00', paymentDate: '2026-03-01', notes: '' });
    fixture.componentInstance.savePayment();
    const req = ctrl.expectOne('/api/weddings/w1/expenses/e1/payments');
    expect(req.request.body).toEqual({ amount: '900.00', paymentDate: '2026-03-01', notes: '' });
    req.flush(
      { error: { code: 'VALIDATION_ERROR', message: 'Too much', fields: { amount: 'This payment is more than the outstanding balance (€600.00).' } } },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    const field = el.querySelector('#payAmount')!.closest('.field')!;
    expect(field.querySelector('.field-error')?.textContent).toContain('more than the outstanding balance');
  });

  it('BR-08: after deleting a payment the expense and the summary are refreshed', () => {
    const { fixture, ctrl, el } = setup();
    fixture.componentInstance.removePayment({ id: 'p1', amount: '400.00', paymentDate: '2026-02-01', notes: null, createdAt: '' });
    ctrl.expectOne('/api/weddings/w1/expenses/e1/payments/p1').flush(expense({ totalPaid: '0.00', outstanding: '1000.00', payments: [] }));
    ctrl.expectOne('/api/weddings/w1/budget').flush(summary({ paid: '0.00' }));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=expense-totals]')?.textContent).toContain('€1,000.00');
    expect(el.textContent).toContain('No payments recorded yet');
  });
});
