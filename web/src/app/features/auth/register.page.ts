import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { navigateToReturnUrl } from '../../core/auth/safe-return-url';
import { applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { OrnamentComponent } from '../../core/ui/ornament.component';
import { ApiError } from '../../core/models/api-error';

import { FieldDirective } from '../../core/ui/field.directive';
@Component({
  selector: 'app-register-page',
  imports: [FieldDirective, ReactiveFormsModule, RouterLink, OrnamentComponent],
  template: `
    <div class="grid min-h-[calc(100vh-4rem)] lg:grid-cols-2">
      <div class="relative hidden overflow-hidden bg-gradient-to-br from-blush to-sage-50 lg:block">
        <app-ornament class="absolute inset-0" />
        <div class="absolute inset-x-0 bottom-0 p-10">
          <p class="max-w-sm font-serif text-2xl text-rose-900">Bring every wedding you plan into one calm, organised place.</p>
        </div>
      </div>
      <div class="flex items-center justify-center px-4 py-12">
        <section class="card w-full max-w-md">
          <h1>Create an account</h1>
          @if (formError(); as msg) {
          <p class="alert alert-danger" role="alert">{{ msg }}</p>
        }
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label class="label" for="name">Name</label>
            <input class="input" id="name" type="text" formControlName="name" autocomplete="name"
              [class.invalid]="nameError()" />
            @if (nameError(); as e) { <span class="field-error">{{ e }}</span> }
          </div>
          <div class="field">
            <label class="label" for="email">Email</label>
            <input class="input" id="email" type="email" formControlName="email" autocomplete="email"
              [class.invalid]="emailError()" />
            @if (emailError(); as e) { <span class="field-error">{{ e }}</span> }
          </div>
          <div class="field">
            <label class="label" for="password">Password</label>
            <input class="input" id="password" type="password" formControlName="password"
              autocomplete="new-password" [class.invalid]="passwordError()" />
            @if (passwordError(); as e) { <span class="field-error">{{ e }}</span> }
          </div>
          <button class="btn btn-primary w-full" type="submit" [disabled]="pending()">
            {{ pending() ? 'Creating account...' : 'Register' }}
          </button>
        </form>
          <p class="mt-5 text-center text-sm text-muted">Already registered? <a routerLink="/login" [queryParams]="linkParams()">Log in</a></p>
        </section>
      </div>
    </div>
  `,
})
export class RegisterPage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly pending = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.pattern(/\S/)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
  });

  nameError(): string | null {
    return fieldError(this.form.controls.name, {
      required: 'Name is required.',
      pattern: 'Name is required.',
    });
  }

  emailError(): string | null {
    return fieldError(this.form.controls.email, {
      required: 'Email is required.',
      email: 'Enter a valid email address.',
    });
  }

  passwordError(): string | null {
    return fieldError(this.form.controls.password, {
      required: 'Password is required.',
      minlength: 'Password must be at least 8 characters.',
      maxlength: 'Password must be at most 72 characters.',
    });
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
    this.auth.register(this.form.getRawValue()).subscribe({
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
