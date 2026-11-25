import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MinimalFooterComponent } from '../core/layout/minimal-footer.component';
import { ApiError } from '../core/models/api-error';
import { RsvpStatus, RsvpView } from '../core/models/guest';
import { DateOnlyPipe } from '../core/pipes/date-only.pipe';
import { RingsIconComponent } from '../core/ui/logo.component';
import { RsvpChipComponent } from '../core/ui/status-chips.component';
import { RsvpService } from './rsvp.service';

type State = 'loading' | 'ready' | 'invalid' | 'closed' | 'error';

/** Guest-facing page: no planner navigation, no links into the app (FR-30). */
@Component({
  selector: 'app-rsvp-page',
  imports: [MinimalFooterComponent, RingsIconComponent, DateOnlyPipe, RsvpChipComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-gradient-to-b from-blush to-ivory">
      <div class="flex justify-center py-6" aria-label="Wedding Organizer" role="img">
        <app-rings-icon [size]="40" />
      </div>
      <main id="main" tabindex="-1" class="mx-auto flex w-full max-w-md flex-1 items-start px-4 pb-8 outline-none">
        <section class="card w-full text-center">
          @switch (state()) {
            @case ('loading') { <p class="py-6 text-muted">Loading your invitation...</p> }
            @case ('invalid') {
              <h1>Invitation not found</h1>
              <p class="text-muted">This invitation link is not valid.</p>
            }
            @case ('closed') {
              <h1>RSVP closed</h1>
              <p class="text-muted" role="alert">{{ message() }}</p>
              <p class="text-sm text-muted">Please contact the couple or their wedding planner if you need to change your answer.</p>
            }
            @case ('error') {
              <h1>Something went wrong</h1>
              <p class="alert alert-danger" role="alert">{{ message() }}</p>
              <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
            }
            @case ('ready') {
              @if (view(); as v) {
                <p class="mb-1 text-sm uppercase tracking-widest text-muted">You are invited to the wedding of</p>
                <h1 class="mb-1">{{ v.coupleNames }}</h1>
                <p class="mb-0">{{ v.weddingDate | dateOnly }}</p>
                <p class="mb-4 text-muted">{{ v.location }}</p>
                <hr class="my-4 border-line" />
                <p class="mb-1">Dear <strong>{{ v.guestName }}</strong>,</p>
                <p class="mb-1 text-sm text-muted">Please reply by {{ v.rsvpDeadline | dateOnly }}.</p>
                <p class="mb-4 text-sm">Your current answer: <app-rsvp-chip [status]="v.rsvpStatus" /></p>

                @if (saved()) { <p class="alert alert-success" role="status">Thank you! Your answer has been saved. You can change it until the deadline.</p> }
                @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

                <div class="field text-left">
                  <label class="label" for="rsvpDiet">Dietary requirements (optional)</label>
                  <textarea class="input" id="rsvpDiet" rows="2" maxlength="500" [value]="diet()" (input)="diet.set($any($event.target).value)"></textarea>
                </div>
                <div class="flex flex-col gap-3">
                  <button type="button" class="btn btn-primary btn-lg" [disabled]="submitting()" (click)="answer('ACCEPTED')">Yes, I'll be there</button>
                  <button type="button" class="btn btn-secondary btn-lg" [disabled]="submitting()" (click)="answer('DECLINED')">Sorry, I can't come</button>
                </div>
              }
            }
          }
        </section>
      </main>
      <app-minimal-footer />
    </div>
  `,
})
export class RsvpPageComponent {
  private readonly api = inject(RsvpService);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  readonly state = signal<State>('loading');
  readonly view = signal<RsvpView | null>(null);
  readonly message = signal('');
  readonly diet = signal('');
  readonly submitting = signal(false);
  readonly saved = signal(false);
  readonly formError = signal<string | null>(null);

  constructor() {
    this.load();
  }

  load(): void {
    if (!this.token) {
      this.state.set('invalid');
      return;
    }
    this.state.set('loading');
    this.api.get(this.token).subscribe({
      next: (v) => this.show(v),
      error: (e: ApiError) => this.fail(e),
    });
  }

  private show(v: RsvpView): void {
    this.view.set(v);
    this.diet.set(v.dietaryRequirements ?? '');
    this.state.set('ready');
  }

  private fail(e: ApiError): void {
    const code = e?.error?.code;
    this.message.set(e?.error?.message ?? 'Something went wrong. Please try again.');
    if (code === 'NOT_FOUND') this.state.set('invalid');
    else if (code === 'RSVP_CLOSED') this.state.set('closed');
    else this.state.set('error');
  }

  answer(status: Exclude<RsvpStatus, 'PENDING'>): void {
    this.submitting.set(true);
    this.saved.set(false);
    this.formError.set(null);
    this.api.submit(this.token, status, this.diet().trim()).subscribe({
      next: (v) => {
        this.submitting.set(false);
        this.view.set(v);
        this.diet.set(v.dietaryRequirements ?? '');
        this.saved.set(true);
      },
      error: (e: ApiError) => {
        this.submitting.set(false);
        const code = e?.error?.code;
        if (code === 'NOT_FOUND' || code === 'RSVP_CLOSED') this.fail(e);
        else this.formError.set(e?.error?.fields?.['dietaryRequirements'] ?? e?.error?.message ?? 'Something went wrong. Please try again.');
      },
    });
  }
}
