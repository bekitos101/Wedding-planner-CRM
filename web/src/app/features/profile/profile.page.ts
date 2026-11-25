import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { UpdateProfileRequest } from '../../core/models/user';

@Component({
  selector: 'app-profile-page',
  imports: [ReactiveFormsModule],
  template: `
    <h1>Profile</h1>

    <section class="card section">
      <h2>Your details</h2>
      @if (detailsError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
      @if (detailsOk()) { <p class="alert alert-success" role="status">Profile saved.</p> }
      <form [formGroup]="details" (ngSubmit)="saveDetails()" novalidate>
        <div class="field">
          <label for="name">Name</label>
          <input id="name" formControlName="name" [class.invalid]="err(details.controls.name, nameMsgs)" />
          @if (err(details.controls.name, nameMsgs); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" formControlName="email"
            [class.invalid]="err(details.controls.email, emailMsgs)" />
          @if (err(details.controls.email, emailMsgs); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        @if (emailChanged()) {
          <div class="field">
            <label for="detailsCurrent">Current password (required to change email)</label>
            <input id="detailsCurrent" type="password" formControlName="currentPassword"
              autocomplete="current-password" [class.invalid]="err(details.controls.currentPassword, curMsgs)" />
            @if (err(details.controls.currentPassword, curMsgs); as e) { <span class="field-error">{{ e }}</span> }
          </div>
        }
        <button class="btn" type="submit" [disabled]="detailsPending()">
          {{ detailsPending() ? 'Saving...' : 'Save changes' }}
        </button>
      </form>
    </section>

    <section class="card section">
      <h2>Change password</h2>
      @if (pwError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
      @if (pwOk()) { <p class="alert alert-success" role="status">Password changed.</p> }
      <form [formGroup]="pw" (ngSubmit)="savePassword()" novalidate>
        <div class="field">
          <label for="password">New password</label>
          <input id="password" type="password" formControlName="password" autocomplete="new-password"
            [class.invalid]="err(pw.controls.password, newMsgs)" />
          @if (err(pw.controls.password, newMsgs); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label for="pwCurrent">Current password</label>
          <input id="pwCurrent" type="password" formControlName="currentPassword"
            autocomplete="current-password" [class.invalid]="err(pw.controls.currentPassword, curMsgs)" />
          @if (err(pw.controls.currentPassword, curMsgs); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <button class="btn" type="submit" [disabled]="pwPending()">
          {{ pwPending() ? 'Saving...' : 'Change password' }}
        </button>
      </form>
    </section>
  `,
  styles: `.section { max-width: 32rem; margin-bottom: 1.25rem; }`,
})
export class ProfilePage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);

  readonly nameMsgs = { required: 'Name is required.', pattern: 'Name is required.' };
  readonly emailMsgs = { required: 'Email is required.', email: 'Enter a valid email address.' };
  readonly curMsgs = { required: 'Current password is required.' };
  readonly newMsgs = {
    required: 'New password is required.',
    minlength: 'Password must be at least 8 characters.',
    maxlength: 'Password must be at most 72 characters.',
  };

  readonly detailsPending = signal(false);
  readonly detailsError = signal<string | null>(null);
  readonly detailsOk = signal(false);
  readonly pwPending = signal(false);
  readonly pwError = signal<string | null>(null);
  readonly pwOk = signal(false);

  private readonly user = this.auth.currentUser;

  readonly details = this.fb.group({
    name: [this.user()?.name ?? '', [Validators.required, Validators.pattern(/\S/)]],
    email: [this.user()?.email ?? '', [Validators.required, Validators.email]],
    currentPassword: [''],
  });

  readonly pw = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
    currentPassword: ['', [Validators.required]],
  });

  private readonly emailValue = toSignal(this.details.controls.email.valueChanges, {
    initialValue: this.details.controls.email.value,
  });
  readonly emailChanged = computed(() => this.emailValue() !== (this.user()?.email ?? ''));

  err = fieldError;

  saveDetails(): void {
    this.detailsError.set(null);
    this.detailsOk.set(false);
    const cur = this.details.controls.currentPassword;
    if (this.emailChanged()) cur.setValidators(Validators.required);
    else cur.clearValidators();
    cur.updateValueAndValidity();

    if (this.details.invalid) {
      this.details.markAllAsTouched();
      return;
    }
    const v = this.details.getRawValue();
    const body: UpdateProfileRequest = { name: v.name.trim() };
    if (this.emailChanged()) {
      body.email = v.email;
      body.currentPassword = v.currentPassword;
    }
    this.detailsPending.set(true);
    this.auth.updateProfile(body).subscribe({
      next: (u) => {
        this.detailsPending.set(false);
        this.detailsOk.set(true);
        this.details.patchValue({ name: u.name, email: u.email, currentPassword: '' });
      },
      error: (e: ApiError) => {
        this.detailsPending.set(false);
        this.detailsError.set(errorMessage(e));
        applyServerFieldErrors(this.details, e);
      },
    });
  }

  savePassword(): void {
    this.pwError.set(null);
    this.pwOk.set(false);
    if (this.pw.invalid) {
      this.pw.markAllAsTouched();
      return;
    }
    this.pwPending.set(true);
    this.auth.updateProfile(this.pw.getRawValue()).subscribe({
      next: () => {
        this.pwPending.set(false);
        this.pwOk.set(true);
        this.pw.reset({ password: '', currentPassword: '' });
      },
      error: (e: ApiError) => {
        this.pwPending.set(false);
        this.pwError.set(errorMessage(e));
        applyServerFieldErrors(this.pw, e);
      },
    });
  }
}
