import { DateOnlyPipe } from '../../core/pipes/date-only.pipe';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Wedding, WeddingListStatus } from '../../core/models/wedding';
import { RoleBadgeComponent } from '../../core/ui/role-badge.component';
import { HealthService, HealthStatus } from '../../core/services/health.service';
import { WeddingService } from './wedding.service';

@Component({
  selector: 'app-weddings-list-page',
  imports: [RouterLink, DateOnlyPipe, RoleBadgeComponent],
  template: `
    @if (problem(); as p) {
      <p class="alert alert-danger" role="alert">{{ p }}</p>
    }
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="mb-0 mr-auto">Weddings</h1>
      <a class="btn btn-primary" routerLink="/weddings/new">New wedding</a>
    </div>

    <div class="mb-5 flex gap-1 border-b border-line" role="group" aria-label="Show weddings">
      <button type="button" class="-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm font-medium"
        [class]="status() === 'active' ? 'border-rose-700 text-rose-800' : 'border-transparent text-muted hover:text-ink'"
        [attr.aria-pressed]="status() === 'active'" (click)="select('active')">Active</button>
      <button type="button" class="-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm font-medium"
        [class]="status() === 'archived' ? 'border-rose-700 text-rose-800' : 'border-transparent text-muted hover:text-ink'"
        [attr.aria-pressed]="status() === 'archived'" (click)="select('archived')">Archived</button>
    </div>

    @if (loading()) {
      <p class="text-muted">Loading weddings...</p>
    } @else if (error(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
    } @else if (weddings().length === 0) {
      <section class="card py-10 text-center">
        @if (status() === 'active') {
          <h2>No weddings yet</h2>
          <p class="mb-4 text-muted">Create your first wedding to start planning guests, tasks and budget.</p>
          <a class="btn btn-primary" routerLink="/weddings/new">Create your first wedding</a>
        } @else {
          <p class="text-muted">No archived weddings.</p>
        }
      </section>
    } @else {
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        @for (w of weddings(); track w.id) {
          <a class="card block text-ink no-underline transition hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-lift"
            [routerLink]="['/weddings', w.id]">
            <div class="flex items-start justify-between gap-2">
              <h2 class="mb-1">{{ w.coupleNames }}</h2>
              <app-role-badge [role]="w.role" />
            </div>
            <p class="mb-3 text-sm text-muted">{{ w.weddingDate | dateOnly }} &middot; {{ w.location }}</p>
            @if (w.status === 'ARCHIVED') { <span class="chip chip-neutral mb-3">Archived</span> }
            <div class="progress" role="progressbar" [attr.aria-valuenow]="w.progress.percent"
              aria-valuemin="0" aria-valuemax="100" aria-label="Planning progress">
              <span [style.width.%]="w.progress.percent"></span>
            </div>
            <p class="mt-1.5 text-sm text-muted">
              @if (w.progress.total === 0) { No tasks yet }
              @else { {{ w.progress.completed }} of {{ w.progress.total }} tasks done }
            </p>
          </a>
        }
      </div>
    }
  `,
})
export class WeddingsListPage {
  private readonly api = inject(WeddingService);
  private readonly health = inject(HealthService);

  readonly status = signal<WeddingListStatus>('active');
  readonly weddings = signal<Wedding[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** Only set when something is wrong; a healthy system shows nothing. */
  readonly problem = signal<string | null>(null);

  constructor() {
    this.health.check().subscribe({
      next: (h: HealthStatus) => {
        if (h.db !== 'ok') this.problem.set('Some data is temporarily unavailable. Please try again shortly.');
      },
      error: () => this.problem.set('Can’t reach the server right now. Please try again shortly.'),
    });
    this.load();
  }

  select(s: WeddingListStatus): void {
    if (s === this.status()) return;
    this.status.set(s);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const requested = this.status();
    this.api.list(requested).subscribe({
      next: (list) => {
        if (requested !== this.status()) return;
        this.weddings.set(list);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        if (requested !== this.status()) return;
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }
}
