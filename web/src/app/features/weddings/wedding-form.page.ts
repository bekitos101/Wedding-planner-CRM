import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Wedding, WeddingInput } from '../../core/models/wedding';
import { WeddingContext } from './wedding-context.service';
import { WeddingService } from './wedding.service';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const MIN_DATE = "2000-01-01";
const MAX_DATE = "2100-12-31";
const DATE_RANGE_MSG = "Enter a date between 2000-01-01 and 2100-12-31.";

/** Calendar dates are "YYYY-MM-DD" strings, 2000-01-01..2100-12-31 (API contract). */
function dateRange(control: AbstractControl): ValidationErrors | null {
  const v = control.value as string;
  return v && (v < MIN_DATE || v > MAX_DATE) ? { range: true } : null;
}

/** rsvpDeadline must be on or before weddingDate (yyyy-MM-dd strings compare correctly). */
function deadlineNotAfterDate(control: AbstractControl): ValidationErrors | null {
  const deadline = control.value as string;
  const date = control.parent?.get('weddingDate')?.value as string | undefined;
  return deadline && date && deadline > date ? { afterWedding: true } : null;
}

import { FieldDirective } from '../../core/ui/field.directive';
@Component({
  selector: 'app-wedding-form-page',
  imports: [FieldDirective, ReactiveFormsModule, RouterLink],
  template: `
    <h1>{{ editing ? 'Edit wedding' : 'New wedding' }}</h1>
    <section class="card max-w-lg">
      @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label class="label" for="coupleNames">Couple names</label>
          <input class="input" id="coupleNames" formControlName="coupleNames" [class.invalid]="err(c.coupleNames, msgs.coupleNames)" />
          @if (err(c.coupleNames, msgs.coupleNames); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="weddingDate">Wedding date</label>
          <input class="input" id="weddingDate" type="date" min="2000-01-01" max="2100-12-31" formControlName="weddingDate" [class.invalid]="err(c.weddingDate, msgs.weddingDate)" />
          @if (err(c.weddingDate, msgs.weddingDate); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="location">Location</label>
          <input class="input" id="location" formControlName="location" [class.invalid]="err(c.location, msgs.location)" />
          @if (err(c.location, msgs.location); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="totalBudget">Estimated budget (EUR)</label>
          <input class="input" id="totalBudget" inputmode="decimal" formControlName="totalBudget" [class.invalid]="err(c.totalBudget, msgs.totalBudget)" />
          @if (err(c.totalBudget, msgs.totalBudget); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="rsvpDeadline">RSVP deadline</label>
          <input class="input" id="rsvpDeadline" type="date" min="2000-01-01" max="2100-12-31" formControlName="rsvpDeadline" [class.invalid]="err(c.rsvpDeadline, msgs.rsvpDeadline)" />
          @if (err(c.rsvpDeadline, msgs.rsvpDeadline); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="flex gap-2">
          <button class="btn btn-primary" type="submit" [disabled]="pending()">
            {{ pending() ? 'Saving...' : editing ? 'Save changes' : 'Create wedding' }}
          </button>
          <a class="btn btn-secondary" [routerLink]="editing ? ['/weddings', weddingId] : ['/weddings']">Cancel</a>
        </div>
      </form>
    </section>
  `,
})
export class WeddingFormPage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(WeddingService);
  private readonly ctx = inject(WeddingContext);
  private readonly router = inject(Router);
  readonly weddingId: string | null = inject(ActivatedRoute).snapshot.paramMap.get('weddingId');
  readonly editing = this.weddingId !== null;

  readonly pending = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    coupleNames: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(200)]],
    weddingDate: ['', [Validators.required, dateRange]],
    location: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(200)]],
    totalBudget: ['', [Validators.required, Validators.pattern(MONEY)]],
    rsvpDeadline: ['', [Validators.required, dateRange, deadlineNotAfterDate]],
  });
  readonly c = this.form.controls;

  readonly msgs = {
    coupleNames: { required: 'Couple names are required.', pattern: 'Couple names are required.', maxlength: 'Use at most 200 characters.' },
    weddingDate: { required: 'Wedding date is required.', range: DATE_RANGE_MSG },
    location: { required: 'Location is required.', pattern: 'Location is required.', maxlength: 'Use at most 200 characters.' },
    totalBudget: {
      required: 'Budget is required.',
      pattern: 'Enter an amount of 0 or more, up to 10 digits and at most 2 decimals.',
    },
    rsvpDeadline: {
      required: 'RSVP deadline is required.',
      range: DATE_RANGE_MSG,
      afterWedding: 'The RSVP deadline must be on or before the wedding date.',
    },
  };

  err = fieldError;

  constructor() {
    // Re-check the deadline rule when the wedding date changes.
    this.c.weddingDate.valueChanges.subscribe(() => this.c.rsvpDeadline.updateValueAndValidity({ emitEvent: false }));
    const w = this.ctx.wedding();
    if (this.editing && w) this.fill(w);
  }

  private fill(w: Wedding): void {
    this.form.setValue({
      coupleNames: w.coupleNames,
      weddingDate: w.weddingDate.slice(0, 10),
      location: w.location,
      totalBudget: w.totalBudget,
      rsvpDeadline: w.rsvpDeadline.slice(0, 10),
    });
  }

  submit(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body: WeddingInput = {
      coupleNames: v.coupleNames.trim(),
      weddingDate: v.weddingDate,
      location: v.location.trim(),
      totalBudget: v.totalBudget.trim(),
      rsvpDeadline: v.rsvpDeadline,
    };
    this.pending.set(true);
    const request = this.editing ? this.api.update(this.weddingId!, body) : this.api.create(body);
    request.subscribe({
      next: (w) => {
        this.pending.set(false);
        if (this.editing) this.ctx.set(w);
        void this.router.navigate(['/weddings', w.id]);
      },
      error: (e: ApiError) => {
        this.pending.set(false);
        this.formError.set(errorMessage(e));
        applyServerFieldErrors(this.form, e);
      },
    });
  }
}
