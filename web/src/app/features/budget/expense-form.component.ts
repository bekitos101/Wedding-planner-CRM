import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { pickDirty, applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Expense } from '../../core/models/budget';
import { FieldDirective } from '../../core/ui/field.directive';
import { BudgetService } from './budget.service';

export const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
export const EXPENSE_CATEGORIES = [
  'Venue', 'Catering', 'Photography', 'Videography', 'Flowers', 'Music', 'Attire', 'Decoration',
  'Cake', 'Transport', 'Stationery', 'Other',
];

@Component({
  selector: 'app-expense-form',
  imports: [ReactiveFormsModule, FieldDirective],
  template: `
    <form class="card mb-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <h2>{{ expense() ? 'Edit expense' : 'Add expense' }}</h2>
      @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
      <div class="field">
        <label class="label" for="expDesc">Description</label>
        <input class="input" id="expDesc" formControlName="description" [class.invalid]="err(form.controls.description)" />
        @if (err(form.controls.description); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      <div class="grid gap-x-4 sm:grid-cols-3">
        <div class="field">
          <label class="label" for="expCategory">Category</label>
          <input class="input" id="expCategory" formControlName="category" list="expense-categories" [class.invalid]="err(form.controls.category)" />
          <datalist id="expense-categories">
            @for (c of categories; track c) { <option [value]="c"></option> }
          </datalist>
          @if (err(form.controls.category); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="expAmount">Agreed amount (€)</label>
          <input class="input" id="expAmount" inputmode="decimal" formControlName="agreedAmount" [class.invalid]="err(form.controls.agreedAmount)" />
          @if (err(form.controls.agreedAmount); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="expDue">Due date</label>
          <input class="input" id="expDue" type="date" formControlName="dueDate" [class.invalid]="err(form.controls.dueDate)" />
          @if (err(form.controls.dueDate); as e) { <span class="field-error">{{ e }}</span> }
        </div>
      </div>
      <div class="field">
        <label class="label" for="expNotes">Notes (optional)</label>
        <textarea class="input" id="expNotes" rows="2" formControlName="notes" [class.invalid]="err(form.controls.notes)"></textarea>
        @if (err(form.controls.notes); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
        <button class="btn btn-secondary" type="button" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
})
export class ExpenseFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(BudgetService);

  readonly weddingId = input.required<string>();
  readonly expense = input<Expense | null>(null);
  readonly saved = output<Expense>();
  readonly cancelled = output<void>();

  readonly categories = EXPENSE_CATEGORIES;
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    description: ['', [Validators.required, Validators.maxLength(200)]],
    category: ['', [Validators.required, Validators.maxLength(60)]],
    agreedAmount: ['', [Validators.required, Validators.pattern(MONEY_PATTERN)]],
    dueDate: ['', Validators.required],
    notes: ['', Validators.maxLength(2000)],
  });

  protected err = (c: Parameters<typeof fieldError>[0]) =>
    fieldError(c, {
      required: 'This field is required.',
      pattern: 'Enter an amount like 1250.00.',
      maxlength: 'This is too long.',
    });

  ngOnInit(): void {
    const x = this.expense();
    if (x) {
      this.form.patchValue({
        description: x.description,
        category: x.category,
        agreedAmount: x.agreedAmount,
        dueDate: x.dueDate,
        notes: x.notes ?? '',
      });
    }
  }

  submit(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      description: v.description.trim(),
      category: v.category.trim(),
      agreedAmount: v.agreedAmount.trim(),
      dueDate: v.dueDate,
      notes: v.notes.trim(),
    };
    const x = this.expense();
    const changes = x ? pickDirty(this.form, body) : body;
    if (x && Object.keys(changes).length === 0) {
      this.cancelled.emit();
      return;
    }
    this.saving.set(true);
    (x ? this.api.update(this.weddingId(), x.id, changes) : this.api.create(this.weddingId(), body)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit(saved);
      },
      error: (e: ApiError) => {
        this.saving.set(false);
        if (e?.error?.fields && Object.keys(e.error.fields).length > 0) applyServerFieldErrors(this.form, e);
        else this.formError.set(errorMessage(e));
      },
    });
  }
}
