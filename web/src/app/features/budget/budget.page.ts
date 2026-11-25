import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { BudgetSummary, Expense } from '../../core/models/budget';
import { DateOnlyPipe } from '../../core/pipes/date-only.pipe';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ArchivedNoteComponent } from '../../core/ui/archived-note.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog.component';
import { WeddingContext } from '../weddings/wedding-context.service';
import { BudgetService } from './budget.service';
import { ExpenseFormComponent } from './expense-form.component';
import { paidPercent } from './money';

@Component({
  selector: 'app-budget-page',
  imports: [RouterLink, DateOnlyPipe, MoneyPipe, ArchivedNoteComponent, ConfirmDialogComponent, ExpenseFormComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="mb-0 mr-auto">Budget</h1>
      @if (ctx.canEdit()) {
        <button type="button" class="btn btn-primary btn-sm" (click)="creating.set(true); editing.set(null)">Add expense</button>
      }
    </div>
    @if (ctx.isArchived()) { <app-archived-note /> }
    @if (notice(); as msg) { <p class="alert alert-success" role="status">{{ msg }}</p> }
    @if (actionError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

    @if (creating() && ctx.canEdit()) {
      <app-expense-form [weddingId]="weddingId()" (saved)="onSaved('Expense added.')" (cancelled)="creating.set(false)" />
    }
    @if (editing(); as x) {
      <app-expense-form [weddingId]="weddingId()" [expense]="x" (saved)="onSaved('Expense saved.')" (cancelled)="editing.set(null)" />
    }

    @if (summary(); as s) {
      <section class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Budget summary" data-testid="summary">
        <div class="card !p-4"><div class="text-sm text-muted">Total budget</div><div class="text-lg font-semibold">{{ s.totalBudget | money }}</div></div>
        <div class="card !p-4"><div class="text-sm text-muted">Committed</div><div class="text-lg font-semibold">{{ s.committed | money }}</div></div>
        <div class="card !p-4"><div class="text-sm text-muted">Paid</div><div class="text-lg font-semibold text-sage-800">{{ s.paid | money }}</div></div>
        <div class="card !p-4"><div class="text-sm text-muted">Outstanding</div><div class="text-lg font-semibold text-amber-900">{{ s.outstanding | money }}</div></div>
        <div class="card col-span-2 !p-4 lg:col-span-1" [class.border-red-300]="overBudget()">
          <div class="text-sm text-muted">Remaining</div>
          @if (overBudget()) {
            <div class="text-lg font-semibold text-red-800" data-testid="remaining">Over budget by {{ overAmount() | money }}</div>
          } @else {
            <div class="text-lg font-semibold" data-testid="remaining">{{ s.remaining | money }}</div>
          }
        </div>
      </section>
      @if (s.overdueExpenses.length > 0) {
        <section class="alert alert-danger" role="alert" data-testid="overdue-alert">
          <strong>{{ s.overdueExpenses.length }} overdue {{ s.overdueExpenses.length === 1 ? 'expense' : 'expenses' }}</strong>
          <ul class="mt-1 list-disc pl-5">
            @for (o of s.overdueExpenses; track o.id) {
              <li>{{ o.description }} — {{ o.outstanding | money }} outstanding since {{ o.dueDate | dateOnly }}</li>
            }
          </ul>
        </section>
      }
    }

    @if (loading()) {
      <p class="text-muted">Loading budget...</p>
    } @else if (loadError(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
    } @else if (expenses().length === 0) {
      <section class="card text-center">
        <p class="py-6 text-muted">No expenses yet.</p>
        @if (ctx.canEdit()) { <button type="button" class="btn btn-primary" (click)="creating.set(true)">Add the first expense</button> }
      </section>
    } @else {
      <ul class="flex flex-col gap-3">
        @for (x of expenses(); track x.id) {
          <li class="row-card" [class.highlight]="x.isOverdue" data-testid="expense-row">
            <div class="min-w-0 flex-1">
              <a class="font-medium" [routerLink]="['/weddings', weddingId(), 'budget', x.id]">{{ x.description }}</a>
              <div class="text-sm text-muted">{{ x.category }} · due {{ x.dueDate | dateOnly }}</div>
              <div class="progress mt-2 max-w-xs" role="progressbar" [attr.aria-label]="'Paid for ' + x.description" [attr.aria-valuenow]="pct(x)" aria-valuemin="0" aria-valuemax="100">
                <span [style.width.%]="pct(x)"></span>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-3 text-sm sm:w-72">
              <div><div class="text-muted">Agreed</div>{{ x.agreedAmount | money }}</div>
              <div><div class="text-muted">Paid</div><span class="text-sage-800">{{ x.totalPaid | money }}</span></div>
              <div><div class="text-muted">Outstanding</div><span [class.text-amber-900]="x.outstanding !== '0.00'">{{ x.outstanding | money }}</span></div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              @if (x.isOverdue) { <span class="chip chip-danger">Overdue</span> }
              <a class="btn btn-secondary btn-sm" [routerLink]="['/weddings', weddingId(), 'budget', x.id]">Payments</a>
              @if (ctx.canEdit()) {
                <button type="button" class="btn btn-secondary btn-sm" (click)="editing.set(x); creating.set(false)">Edit</button>
                <button type="button" class="btn btn-secondary btn-sm" (click)="toDelete.set(x)">Delete</button>
              }
            </div>
          </li>
        }
      </ul>
    }

    @if (toDelete(); as x) {
      <app-confirm-dialog title="Delete this expense?" [message]="'“' + x.description + '” and all its payments will be removed.'"
        confirmLabel="Delete expense" [busy]="deleting()" (confirmed)="remove(x)" (cancelled)="toDelete.set(null)" />
    }
  `,
})
export class BudgetPage {
  protected readonly ctx = inject(WeddingContext);
  private readonly api = inject(BudgetService);

  readonly weddingId = computed(() => this.ctx.wedding()!.id);
  readonly expenses = signal<Expense[]>([]);
  readonly summary = signal<BudgetSummary | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly creating = signal(false);
  readonly editing = signal<Expense | null>(null);
  readonly toDelete = signal<Expense | null>(null);
  readonly deleting = signal(false);

  readonly overBudget = computed(() => Number(this.summary()?.remaining ?? 0) < 0);
  readonly overAmount = computed(() => String(this.summary()?.remaining ?? '0').replace('-', ''));
  pct = (x: Expense) => paidPercent(x.totalPaid, x.agreedAmount);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.list(this.weddingId()).subscribe({
      next: (list) => {
        this.expenses.set(list);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.loadError.set(errorMessage(e));
        this.loading.set(false);
      },
    });
    this.loadSummary();
  }

  private loadSummary(): void {
    this.api.summary(this.weddingId()).subscribe({
      next: (s) => this.summary.set(s),
      error: () => this.summary.set(null),
    });
  }

  onSaved(msg: string): void {
    this.creating.set(false);
    this.editing.set(null);
    this.notice.set(msg);
    this.load();
  }

  remove(x: Expense): void {
    this.deleting.set(true);
    this.api.remove(this.weddingId(), x.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.toDelete.set(null);
        this.notice.set('Expense deleted.');
        this.load();
      },
      error: (e: ApiError) => {
        this.deleting.set(false);
        this.toDelete.set(null);
        this.actionError.set(errorMessage(e));
      },
    });
  }
}
