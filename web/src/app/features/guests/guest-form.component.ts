import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { pickDirty, applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Guest, RsvpStatus } from '../../core/models/guest';
import { FieldDirective } from '../../core/ui/field.directive';
import { GuestService } from './guest.service';

@Component({
  selector: 'app-guest-form',
  imports: [ReactiveFormsModule, FieldDirective],
  template: `
    <form class="card mb-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <h2>{{ guest() ? 'Edit guest' : 'Add guest' }}</h2>
      @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
      <div class="grid gap-x-4 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="guestName">Name</label>
          <input class="input" id="guestName" formControlName="name" [class.invalid]="err(form.controls.name)" />
          @if (err(form.controls.name); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="guestEmail">Email</label>
          <input class="input" id="guestEmail" type="email" formControlName="email" [class.invalid]="err(form.controls.email)" />
          @if (err(form.controls.email); as e) { <span class="field-error">{{ e }}</span> }
        </div>
      </div>
      <div class="field">
        <label class="label" for="guestDiet">Dietary requirements (optional)</label>
        <input class="input" id="guestDiet" formControlName="dietaryRequirements" [class.invalid]="err(form.controls.dietaryRequirements)" />
        @if (err(form.controls.dietaryRequirements); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      @if (guest()) {
        <div class="field max-w-xs">
          <label class="label" for="guestRsvp">RSVP status</label>
          <select class="input" id="guestRsvp" formControlName="rsvpStatus" [class.invalid]="err(form.controls.rsvpStatus)">
            <option value="PENDING">Pending</option><option value="ACCEPTED">Accepted</option><option value="DECLINED">Declined</option>
          </select>
          @if (err(form.controls.rsvpStatus); as e) { <span class="field-error">{{ e }}</span> }
        </div>
      }
      <div class="flex gap-2">
        <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
        <button class="btn btn-secondary" type="button" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
})
export class GuestFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(GuestService);

  readonly weddingId = input.required<string>();
  readonly guest = input<Guest | null>(null);
  readonly saved = output<Guest>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(150)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    dietaryRequirements: ['', Validators.maxLength(500)],
    rsvpStatus: ['PENDING' as RsvpStatus],
  });

  protected err = (c: Parameters<typeof fieldError>[0]) =>
    fieldError(c, {
      required: 'This field is required.',
      email: 'Enter a valid email address.',
      maxlength: 'This is too long.',
    });

  ngOnInit(): void {
    const g = this.guest();
    if (g) {
      this.form.patchValue({
        name: g.name,
        email: g.email,
        dietaryRequirements: g.dietaryRequirements ?? '',
        rsvpStatus: g.rsvpStatus,
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
    const g = this.guest();
    const base = { name: v.name.trim(), email: v.email.trim(), dietaryRequirements: v.dietaryRequirements.trim() };
    const changes = g ? pickDirty(this.form, { ...base, rsvpStatus: v.rsvpStatus }) : base;
    if (g && Object.keys(changes).length === 0) {
      this.cancelled.emit();
      return;
    }
    this.saving.set(true);
    const req = g
      ? this.api.update(this.weddingId(), g.id, changes)
      : this.api.create(this.weddingId(), base);
    req.subscribe({
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
