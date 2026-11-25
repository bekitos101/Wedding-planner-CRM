import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { navigateToReturnUrl } from '../../core/auth/safe-return-url';
import { applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <section class="card auth-card">
        <h1>Log in</h1>
        @if (formError(); as msg) {
          <p class="alert alert-danger" role="alert">{{ msg }}</p>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" formControlName="email" autocomplete="email"
              [class.invalid]="emailError()" />
            @if (emailError(); as e) { <span class="field-error">{{ e }}</span> }
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" type="password" formControlName="password"
              autocomplete="current-password" [class.invalid]="passwordError()" />
            @if (passwordError(); as e) { <span class="field-error">{{ e }}</span> }
          </div>
          <button class="btn" type="submit" [disabled]="pending()">
            {{ pending() ? 'Logging in...' : 'Log in' }}
          </button>
        </form>
        <p class="muted">No account yet? <a routerLink="/register" [queryParams]="linkParams()">Register</a></p>
      </section>
    </div>
  `,
})
export class LoginPage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly pending = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  emailError(): string | null {
    return fieldError(this.form.controls.email, {
      required: 'Email is required.',
      email: 'Enter a valid email address.',
    });
  }

  passwordError(): string | null {
    return fieldError(this.form.controls.password, { required: 'Password is required.' });
  }

  linkParams(): Record<string, string> {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return returnUrl ? { returnUrl } : {};
  }

  submit(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.auth.login(this.form.getRawValue()).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        void navigateToReturnUrl(this.router, returnUrl);
      },
      error: (err: ApiError) => {
        this.pending.set(false);
        this.formError.set(errorMessage(err));
        applyServerFieldErrors(this.form, err);
      },
    });
  }
}
