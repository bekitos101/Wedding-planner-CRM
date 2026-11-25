import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { ContactService } from '../../core/services/contact.service';

import { FieldDirective } from '../../core/ui/field.directive';
@Component({
  selector: 'app-contact-page',
  imports: [FieldDirective, ReactiveFormsModule],
  template: `
    <div class="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-5">
      <section class="lg:col-span-3">
        <h1 class="text-4xl">Contact us</h1>
        <p class="mb-6 text-muted">Questions about Wedding Organizer? Send us a message and we will get back to you.</p>

        @if (sentMessage(); as done) {
          <div class="card text-center" role="status">
            <h2>Message sent</h2>
            <p class="text-muted">{{ done }}</p>
            <button type="button" class="btn btn-secondary" (click)="reset()">Send another message</button>
          </div>
        } @else {
          <div class="card">
            @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
            <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
              <div class="field">
                <label class="label" for="contactName">Name</label>
                <input class="input" id="contactName" type="text" formControlName="name" autocomplete="name"
                  [class.invalid]="err(form.controls.name, msgs.name)" />
                @if (err(form.controls.name, msgs.name); as e) { <span class="field-error">{{ e }}</span> }
              </div>
              <div class="field">
                <label class="label" for="contactEmail">Email</label>
                <input class="input" id="contactEmail" type="email" formControlName="email" autocomplete="email"
                  [class.invalid]="err(form.controls.email, msgs.email)" />
                @if (err(form.controls.email, msgs.email); as e) { <span class="field-error">{{ e }}</span> }
              </div>
              <div class="field">
                <label class="label" for="contactSubject">Subject <span class="font-normal text-muted">(optional)</span></label>
                <input class="input" id="contactSubject" type="text" formControlName="subject"
                  [class.invalid]="err(form.controls.subject, msgs.subject)" />
                @if (err(form.controls.subject, msgs.subject); as e) { <span class="field-error">{{ e }}</span> }
              </div>
              <div class="field">
                <label class="label" for="contactMessage">Message</label>
                <textarea class="input" id="contactMessage" rows="6" formControlName="message"
                  [class.invalid]="err(form.controls.message, msgs.message)"></textarea>
                @if (err(form.controls.message, msgs.message); as e) { <span class="field-error">{{ e }}</span> }
              </div>

              <!-- Honeypot: hidden from people and screen readers; bots tend to fill it in. -->
              <div class="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true" data-testid="honeypot">
                <label for="contactHp">Leave this field empty</label>
                <input id="contactHp" name="contact_hp" type="text" formControlName="contact_hp" tabindex="-1" autocomplete="off" />
              </div>

              <button class="btn btn-primary" type="submit" [disabled]="pending()">
                {{ pending() ? 'Sending...' : 'Send message' }}
              </button>
            </form>
          </div>
        }
      </section>

      <aside class="lg:col-span-2">
        <div class="card bg-blush/60">
          <h2>What to expect</h2>
          <p class="text-sm text-muted">
            We read every message and aim to reply within a few working days. Please do not include passwords or
            payment details.
          </p>
          <p class="mt-4 text-sm">
            Prefer email?<br />
            <a href="mailto:hello@wedding-organizer.local">hello&#64;wedding-organizer.local</a>
          </p>
        </div>
      </aside>
    </div>
  `,
})
export class ContactPage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(ContactService);

  readonly pending = signal(false);
  readonly formError = signal<string | null>(null);
  readonly sentMessage = signal<string | null>(null);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    subject: ['', [Validators.maxLength(150)]],
    message: ['', [Validators.required, trimmedLength(10, 5000)]],
    contact_hp: [''],
  });

  readonly msgs = {
    name: { required: 'Name is required.', pattern: 'Name is required.', maxlength: 'Use at most 100 characters.' },
    email: {
      required: 'Email is required.',
      email: 'Enter a valid email address.',
      maxlength: 'Use at most 254 characters.',
    },
    subject: { maxlength: 'Use at most 150 characters.' },
    message: {
      required: 'Message is required.',
      tooShort: 'Message must be at least 10 characters.',
      tooLong: 'Message must be at most 5000 characters.',
    },
  };

  err = fieldError;

  submit(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      name: v.name.trim(),
      email: v.email.trim(),
      ...(v.subject.trim() ? { subject: v.subject.trim() } : {}),
      message: v.message.trim(),
      contact_hp: v.contact_hp,
    };
    this.pending.set(true);
    this.api.send(body).subscribe({
      next: (res) => {
        this.pending.set(false);
        this.sentMessage.set(res.message);
      },
      error: (e: ApiError) => {
        this.pending.set(false);
        // 400: field errors next to inputs; 429/503 and others: message in the alert.
        this.formError.set(errorMessage(e));
        applyServerFieldErrors(this.form, e);
      },
    });
  }

  reset(): void {
    this.form.reset({ name: '', email: '', subject: '', message: '', contact_hp: '' });
    this.sentMessage.set(null);
    this.formError.set(null);
  }
}

function trimmedLength(min: number, max: number) {
  return (control: { value: unknown }) => {
    const len = String(control.value ?? '').trim().length;
    if (len === 0) return null; // `required` reports the empty case
    if (len < min) return { tooShort: true };
    if (len > max) return { tooLong: true };
    return null;
  };
}
