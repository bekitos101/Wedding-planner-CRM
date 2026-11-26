import { DateOnlyPipe } from '../../core/pipes/date-only.pipe';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog.component';
import { DashboardPanelComponent } from '../dashboard/dashboard-panel.component';
import { WeddingContext } from './wedding-context.service';
import { WeddingService } from './wedding.service';

@Component({
  selector: 'app-wedding-overview-page',
  imports: [RouterLink, DateOnlyPipe, MoneyPipe, ConfirmDialogComponent, DashboardPanelComponent],
  template: `
    @if (ctx.wedding(); as w) {
      @if (ctx.isArchived()) {
        <p class="alert alert-info" role="status">Archived — read-only</p>
      }
      @if (actionError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

      <div class="mb-4 flex flex-wrap items-center gap-3">
        <h1 class="mb-0 mr-auto">{{ w.coupleNames }}</h1>
        @if (ctx.canEdit()) {
          <a class="btn btn-secondary btn-sm" [routerLink]="['/weddings', w.id, 'edit']">Edit</a>
          <button type="button" class="btn btn-danger btn-sm" (click)="confirming.set(true)">Archive</button>
        }
      </div>

      <section class="card">
        <dl class="grid gap-x-4 gap-y-1 sm:grid-cols-[11rem_1fr] sm:gap-y-3">
          <dt>Wedding date</dt><dd class="mb-3 sm:mb-0">{{ w.weddingDate | dateOnly }}</dd>
          <dt>Location</dt><dd class="mb-3 sm:mb-0">{{ w.location }}</dd>
          <dt>Estimated budget</dt><dd class="mb-3 sm:mb-0">{{ w.totalBudget | money }}</dd>
          <dt>RSVP deadline</dt><dd class="mb-3 sm:mb-0">{{ w.rsvpDeadline | dateOnly }}</dd>
          <dt>Status</dt>
          <dd class="mb-3 sm:mb-0"><span class="chip" [class.chip-success]="w.status === 'ACTIVE'" [class.chip-neutral]="w.status !== 'ACTIVE'">{{ w.status === 'ACTIVE' ? 'Active' : 'Archived' }}</span></dd>
          <dt>Owner</dt><dd class="mb-3 sm:mb-0">{{ w.owner.name }}</dd>
          <dt>Planning progress</dt>
          <dd class="mb-3 sm:mb-0">
            <div class="progress" role="progressbar" [attr.aria-valuenow]="w.progress.percent" aria-valuemin="0" aria-valuemax="100">
              <span [style.width.%]="w.progress.percent"></span>
            </div>
            <span class="text-sm text-muted">
              @if (w.progress.total === 0) { No tasks yet }
              @else { {{ w.progress.completed }} of {{ w.progress.total }} tasks done ({{ w.progress.percent }}%) }
            </span>
          </dd>
        </dl>
      </section>

      <app-dashboard-panel [weddingId]="w.id" />

      @if (confirming()) {
        <app-confirm-dialog
          title="Archive this wedding?"
          message="Archived weddings become read-only. This can't be undone."
          confirmLabel="Archive"
          [busy]="busy()"
          (confirmed)="archive()"
          (cancelled)="confirming.set(false)" />
      }
    }
  `,
})
export class WeddingOverviewPage {
  protected readonly ctx = inject(WeddingContext);
  private readonly api = inject(WeddingService);

  readonly confirming = signal(false);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);

  archive(): void {
    const w = this.ctx.wedding();
    if (!w) return;
    this.busy.set(true);
    this.actionError.set(null);
    this.api.archive(w.id).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.confirming.set(false);
        this.ctx.set(updated);
      },
      error: (e: ApiError) => {
        this.busy.set(false);
        this.confirming.set(false);
        this.actionError.set(errorMessage(e));
      },
    });
  }
}
