import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../core/auth/auth.service';
import { ApiError } from '../core/models/api-error';
import { HealthService, HealthStatus } from '../core/services/health.service';

@Component({
  selector: 'app-home',
  template: `
    @if (problem(); as p) {
      <p class="banner" role="alert">{{ p }}</p>
    }
    <h1>Welcome, {{ auth.currentUser()?.name }}</h1>
    <section class="card">
      <p class="muted">Your weddings will appear here.</p>
    </section>
  `,
  styles: `
    .banner {
      margin: 0 0 1rem;
      padding: 0.6rem 0.9rem;
      border-radius: 6px;
      background: color-mix(in srgb, var(--color-danger) 12%, transparent);
      color: var(--color-danger);
      font-size: 0.9rem;
    }
  `,
})
export class HomeComponent {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(HealthService);
  /** Only set when something is wrong; a healthy system shows nothing. */
  readonly problem = signal<string | null>(null);

  constructor() {
    this.api.check().subscribe({
      next: (h: HealthStatus) => {
        if (h.db !== 'ok') this.problem.set('Some data is temporarily unavailable. Please try again shortly.');
      },
      error: (_e: ApiError) =>
        this.problem.set('Can’t reach the server right now. Please try again shortly.'),
    });
  }
}
