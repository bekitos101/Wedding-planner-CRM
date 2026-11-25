import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { pickDirty, applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { BudgetSummary, Expense, Payment } from '../../core/models/budget';
import { DateOnlyPipe } from '../../core/pipes/date-only.pipe';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ArchivedNoteComponent } from '../../core/ui/archived-note.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog.component';
import { FieldDirective } from '../../core/ui/field.directive';
import { WeddingContext } from '../weddings/wedding-context.service';
import { BudgetService } from './budget.service';
import { MONEY_PATTERN } from './expense-form.component';
import { paidPercent } from './money';

/** `/weddings/:id/budget/:expenseId` — one expense with its payments (FR-42..44). */
@Component({
  selector: 'app-expense-detail-page',
  imports: [RouterLink, ReactiveFormsModule, FieldDirective, DateOnlyPipe, MoneyPipe, ArchivedNoteComponent, ConfirmDialogComponent],
  template: `
    <p class="mb-2"><a [routerLink]="['/weddings', weddingId(), 'budget']">&larr; Back to budget</a></p>
    @if (ctx.isArchived()) { <app-archived-note /> }
    @if (actionError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

    @if (loading()) {
      <p class="text-muted">Loading expense...</p>
    } @else if (notFound()) {
      <section class="card max-w-lg"><h1>Expense not found</h1><p class="text-muted">It may have been deleted.</p></section>
    } @else if (loadError(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
    } @else if (expense(); as x) {
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <h1 class="mb-0">{{ x.description }}</h1>
        <span class="chip chip-neutral">{{ x.category }}</span>
        @if (x.isOverdue) { <span class="chip chip-danger">Overdue</span> }
      </div>

      <section class="card mb-4" data-testid="expense-totals">
        <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><dt class="text-sm">Agreed</dt><dd class="font-semibold">{{ x.agreedAmount | money }}</dd></div>
          <div><dt class="text-sm">Paid</dt><dd class="font-semibold text-sage-800">{{ x.totalPaid | money }}</dd></div>
          <div><dt class="text-sm">Outstanding</dt><dd class="font-semibold text-amber-900">{{ x.outstanding | money }}</dd></div>
          <div><dt class="text-sm">Due</dt><dd class="font-semibold">{{ x.dueDate | dateOnly }}</dd></div>
        </dl>
        <div class="progress mt-3" role="progressbar" [attr.aria-valuenow]="pct()" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="pct()"></span></div>
        @if (x.notes) { <p class="mt-3 mb-0 text-sm">{{ x.notes }}</p> }
        @if (summary(); as s) {
          <p class="mt-3 mb-0 text-sm text-muted">
            Wedding budget:
            @if (overBudget()) { <span class="text-red-800">over budget by {{ overAmount() | money }}</span> }
            @else { {{ s.remaining | money }} remaining }
          </p>
        }
      </section>

      @if (ctx.canEdit()) {
        <form class="card mb-4" [formGroup]="form" (ngSubmit)="savePayment()" novalidate>
          <h2>{{ editingPayment() ? 'Edit payment' : 'Add payment' }}</h2>
          @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
          <div class="grid gap-x-4 sm:grid-cols-3">
            <div class="field">
              <label class="label" for="payAmount">Amount (€)</label>
              <input class="input" id="payAmount" inputmode="decimal" formControlName="amount" [class.invalid]="err(form.controls.amount)" />
              @if (err(form.controls.amount); as e) { <span class="field-error">{{ e }}</span> }
            </div>
            <div class="field">
              <label class="label" for="payDate">Payment date</label>
              <input class="input" id="payDate" type="date" formControlName="paymentDate" [class.invalid]="err(form.controls.paymentDate)" />
              @if (err(form.controls.paymentDate); as e) { <span class="field-error">{{ e }}</span> }
            </div>
            <div class="field">
              <label class="label" for="payNotes">Notes (optional)</label>
              <input class="input" id="payNotes" formControlName="notes" [class.invalid]="err(form.controls.notes)" />
              @if (err(form.controls.notes); as e) { <span class="field-error">{{ e }}</span> }
            </div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : editingPayment() ? 'Save payment' : 'Add payment' }}</button>
            @if (editingPayment()) { <button class="btn btn-secondary" type="button" (click)="resetForm()">Cancel</button> }
          </div>
        </form>
      }

      <section class="card">
        <h2>Payments</h2>
        @if ((x.payments ?? []).length === 0) {
          <p class="text-muted">No payments recorded yet.</p>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (p of x.payments; track p.id) {
              <li class="row-card" data-testid="payment-row">
                <div class="min-w-0 flex-1">
                  <div class="font-medium">{{ p.amount | money }}</div>
                  <div class="text-sm text-muted">{{ p.paymentDate | dateOnly }}@if (p.notes) { · {{ p.notes }} }</div>
                </div>
                @if (ctx.canEdit()) {
                  <div class="flex gap-2">
                    <button type="button" class="btn btn-secondary btn-sm" (click)="startEdit(p)">Edit</button>
                    <button type="button" class="btn btn-secondary btn-sm" (click)="toDelete.set(p)">Delete</button>
                  </div>
                }
              </li>
            }
          </ul>
        }
      </section>
    }

    @if (toDelete(); as p) {
      <app-confirm-dialog title="Delete this payment?" [message]="'The ' + (p.amount | money) + ' payment will be removed and the balance recalculated.'"
        confirmLabel="Delete payment" [busy]="deleting()" (confirmed)="removePayment(p)" (cancelled)="toDelete.set(null)" />
    }
  `,
})
export class ExpenseDetailPage {
  protected readonly ctx = inject(WeddingContext);
  private readonly api = inject(BudgetService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly expenseId = inject(ActivatedRoute).snapshot.paramMap.get('expenseId') ?? '';

  readonly weddingId = computed(() => this.ctx.wedding()!.id);
  readonly expense = signal<Expense | null>(null);
  readonly summary = signal<BudgetSummary | null>(null);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly editingPayment = signal<Payment | null>(null);
  readonly toDelete = signal<Payment | null>(null);
  readonly deleting = signal(false);

  readonly form = this.fb.group({
    amount: ['', [Validators.required, Validators.pattern(MONEY_PATTERN)]],
    paymentDate: ['', Validators.required],
    notes: ['', Validators.maxLength(2000)],
  });

  readonly pct = computed(() => paidPercent(this.expense()?.totalPaid ?? '0', this.expense()?.agreedAmount ?? '0'));
  readonly overBudget = computed(() => Number(this.summary()?.remaining ?? 0) < 0);
  readonly overAmount = computed(() => String(this.summary()?.remaining ?? '0').replace('-', ''));

  protected err = (c: Parameters<typeof fieldError>[0]) =>
    fieldError(c, {
      required: 'This field is required.',
      pattern: 'Enter an amount like 250.00.',
      maxlength: 'This is too long.',
    });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.notFound.set(false);
    this.api.get(this.weddingId(), this.expenseId).subscribe({
      next: (x) => {
        this.expense.set(x);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.loading.set(false);
        if (e?.error?.code === 'NOT_FOUND') this.notFound.set(true);
        else this.loadError.set(errorMessage(e));
      },
    });
    this.refreshSummary();
  }

  private refreshSummary(): void {
    this.api.summary(this.weddingId()).subscribe({ next: (s) => this.summary.set(s), error: () => undefined });
  }

  /** Payment writes return the recalculated expense; refresh the wedding summary too (BR-08). */
  private applyExpense(x: Expense): void {
    this.expense.set(x);
    this.refreshSummary();
  }

  startEdit(p: Payment): void {
    this.editingPayment.set(p);
    this.formError.set(null);
    this.form.reset({ amount: p.amount, paymentDate: p.paymentDate, notes: p.notes ?? '' });
  }

  resetForm(): void {
    this.editingPayment.set(null);
    this.formError.set(null);
    this.form.reset({ amount: '', paymentDate: '', notes: '' });
  }

  savePayment(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = { amount: v.amount.trim(), paymentDate: v.paymentDate, notes: v.notes.trim() };
    const p = this.editingPayment();
    const changes = p ? pickDirty(this.form, body) : body;
    if (p && Object.keys(changes).length === 0) {
      this.resetForm();
      return;
    }
    this.saving.set(true);
    const req = p
      ? this.api.updatePayment(this.weddingId(), this.expenseId, p.id, changes)
      : this.api.addPayment(this.weddingId(), this.expenseId, body);
    req.subscribe({
      next: (x) => {
        this.saving.set(false);
        this.resetForm();
        this.applyExpense(x);
      },
      error: (e: ApiError) => {
        this.saving.set(false);
        // e.g. overpayment: "This payment is more than the outstanding balance" under the amount field.
        if (e?.error?.fields && Object.keys(e.error.fields).length > 0) applyServerFieldErrors(this.form, e);
        else this.formError.set(errorMessage(e));
      },
    });
  }

  removePayment(p: Payment): void {
    this.deleting.set(true);
    this.api.removePayment(this.weddingId(), this.expenseId, p.id).subscribe({
      next: (x) => {
        this.deleting.set(false);
        this.toDelete.set(null);
        if (this.editingPayment()?.id === p.id) this.resetForm();
        this.applyExpense(x);
      },
      error: (e: ApiError) => {
        this.deleting.set(false);
        this.toDelete.set(null);
        this.actionError.set(errorMessage(e));
      },
    });
  }
}
