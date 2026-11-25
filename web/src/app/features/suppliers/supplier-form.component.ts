import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { pickDirty, applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Supplier } from '../../core/models/supplier';
import { FieldDirective } from '../../core/ui/field.directive';
import { EXPENSE_CATEGORIES, MONEY_PATTERN } from '../budget/expense-form.component';
import { SupplierService } from './supplier.service';

@Component({
  selector: 'app-supplier-form',
  imports: [ReactiveFormsModule, FieldDirective],
  template: `
    <form class="card mb-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <h2>{{ supplier() ? 'Edit supplier' : 'Add supplier' }}</h2>
      @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
      <div class="grid gap-x-4 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="supName">Name</label>
          <input class="input" id="supName" formControlName="name" [class.invalid]="err(form.controls.name)" />
          @if (err(form.controls.name); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="supCategory">Service category</label>
          <input class="input" id="supCategory" formControlName="category" list="supplier-categories" [class.invalid]="err(form.controls.category)" />
          <datalist id="supplier-categories">
            @for (c of categories; track c) { <option [value]="c"></option> }
          </datalist>
          @if (err(form.controls.category); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="supContact">Contact info (optional)</label>
          <input class="input" id="supContact" formControlName="contactInfo" placeholder="Phone, email or website" [class.invalid]="err(form.controls.contactInfo)" />
          @if (err(form.controls.contactInfo); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="supPrice">Quoted price (€, optional)</label>
          <input class="input" id="supPrice" inputmode="decimal" formControlName="quotedPrice" [class.invalid]="err(form.controls.quotedPrice)" />
          @if (err(form.controls.quotedPrice); as e) { <span class="field-error">{{ e }}</span> }
        </div>
      </div>
      <div class="field">
        <label class="label" for="supNotes">Notes (optional)</label>
        <textarea class="input" id="supNotes" rows="2" formControlName="notes" [class.invalid]="err(form.controls.notes)"></textarea>
        @if (err(form.controls.notes); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
        <button class="btn btn-secondary" type="button" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
})
export class SupplierFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(SupplierService);

  readonly weddingId = input.required<string>();
  readonly supplier = input<Supplier | null>(null);
  readonly saved = output<Supplier>();
  readonly cancelled = output<void>();

  readonly categories = EXPENSE_CATEGORIES;
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(150)]],
    category: ['', [Validators.required, Validators.maxLength(60)]],
    contactInfo: ['', Validators.maxLength(500)],
    quotedPrice: ['', Validators.pattern(MONEY_PATTERN)],
    notes: ['', Validators.maxLength(2000)],
  });

  protected err = (c: Parameters<typeof fieldError>[0]) =>
    fieldError(c, {
      required: 'This field is required.',
      pattern: 'Enter an amount like 1250.00.',
      maxlength: 'This is too long.',
    });

  ngOnInit(): void {
    const s = this.supplier();
    if (s) {
      this.form.patchValue({
        name: s.name,
        category: s.category,
        contactInfo: s.contactInfo ?? '',
        quotedPrice: s.quotedPrice ?? '',
        notes: s.notes ?? '',
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
      name: v.name.trim(),
      category: v.category.trim(),
      contactInfo: v.contactInfo.trim(),
      quotedPrice: v.quotedPrice.trim() || null,
      notes: v.notes.trim(),
    };
    const s = this.supplier();
    const changes = s ? pickDirty(this.form, body) : body;
    if (s && Object.keys(changes).length === 0) {
      this.cancelled.emit();
      return;
    }
    this.saving.set(true);
    (s ? this.api.update(this.weddingId(), s.id, changes) : this.api.create(this.weddingId(), body)).subscribe({
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
