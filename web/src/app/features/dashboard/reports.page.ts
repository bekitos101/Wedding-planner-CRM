import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { errorMessage } from '../../core/forms/server-errors';
import { BudgetReport, GuestReport, ReportInvitationStatus } from '../../core/models/reports';
import { DateOnlyPipe } from '../../core/pipes/date-only.pipe';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { RsvpChipComponent } from '../../core/ui/status-chips.component';
import { WeddingContext } from '../weddings/wedding-context.service';
import { budgetCsv, csvFilename, downloadCsv, guestsCsv } from './csv';
import { DashboardService } from './dashboard.service';

const INVITATION_CHIP: Record<ReportInvitationStatus, { label: string; cls: string }> = {
  NOT_SENT: { label: 'Not sent', cls: 'chip-neutral' },
  SENT: { label: 'Sent', cls: 'chip-success' },
  FAILED: { label: 'Failed', cls: 'chip-danger' },
  REVOKED: { label: 'Revoked', cls: 'chip-neutral' },
};

/** Guest-response and budget-by-category reports (FR-58), with CSV export and print. */
@Component({
  selector: 'app-reports-page',
  imports: [DateOnlyPipe, MoneyPipe, RsvpChipComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="mb-0 mr-auto">Reports</h1>
      <button type="button" class="btn btn-secondary btn-sm no-print" (click)="print()">Print</button>
    </div>

    @if (error(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary btn-sm" (click)="load()">Try again</button>
    } @else if (!guests() || !budget()) {
      <div class="card h-40 animate-pulse bg-stone-50" aria-busy="true" aria-label="Loading reports"></div>
    } @else {
      @let g = guests()!;
      @let b = budget()!;

      <section class="card mb-6" aria-labelledby="gr-h">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <h2 id="gr-h" class="mb-0 mr-auto">Guest responses</h2>
          <button type="button" class="btn btn-secondary btn-sm no-print" (click)="downloadGuests()">Download CSV</button>
        </div>
        <div class="mb-4 flex flex-wrap items-center gap-2" data-testid="guest-summary">
          <span class="chip chip-neutral">{{ g.summary.total }} guests</span>
          <span class="chip chip-success">{{ g.summary.accepted }} accepted</span>
          <span class="chip chip-danger">{{ g.summary.declined }} declined</span>
          <span class="chip chip-warning">{{ g.summary.pending }} pending</span>
          <span class="text-sm text-muted">Response rate {{ g.summary.responseRate }}%</span>
        </div>

        <h3 class="mb-2 text-lg font-semibold">Dietary requirements</h3>
        @if (g.dietary.length === 0) {
          <p class="text-muted" data-testid="no-dietary">No dietary requirements have been noted.</p>
        } @else {
          <div class="overflow-x-auto">
            <table data-testid="dietary-table">
              <thead><tr><th>Name</th><th>RSVP</th><th>Requirement</th></tr></thead>
              <tbody>
                @for (d of g.dietary; track $index) {
                  <tr><td>{{ d.name }}</td><td><app-rsvp-chip [status]="d.rsvpStatus" /></td><td>{{ d.dietaryRequirements }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        }

        <h3 class="mb-2 mt-6 text-lg font-semibold">All guests</h3>
        @if (g.guests.length === 0) {
          <p class="text-muted">No guests yet.</p>
        } @else {
          <div class="overflow-x-auto">
            <table data-testid="guest-table">
              <thead><tr><th>Name</th><th>Email</th><th>RSVP</th><th>Responded</th><th>Invitation</th></tr></thead>
              <tbody>
                @for (x of g.guests; track $index) {
                  <tr>
                    <td>{{ x.name }}</td>
                    <td>{{ x.email }}</td>
                    <td><app-rsvp-chip [status]="x.rsvpStatus" /></td>
                    <td>{{ x.respondedAt ? (x.respondedAt | dateOnly) : '—' }}</td>
                    <td><span class="chip" [class]="chip(x.invitationStatus).cls">{{ chip(x.invitationStatus).label }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <section class="card" aria-labelledby="br-h">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          <h2 id="br-h" class="mb-0 mr-auto">Budget by category</h2>
          <button type="button" class="btn btn-secondary btn-sm no-print" (click)="downloadBudget()">Download CSV</button>
        </div>
        <dl class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="budget-totals">
          <div><dt>Budget</dt><dd class="font-semibold">{{ b.totals.totalBudget | money }}</dd></div>
          <div><dt>Committed</dt><dd class="font-semibold">{{ b.totals.committed | money }}</dd></div>
          <div><dt>Paid</dt><dd class="font-semibold">{{ b.totals.paid | money }}</dd></div>
          <div><dt>Outstanding</dt><dd class="font-semibold">{{ b.totals.outstanding | money }}</dd></div>
          <div>
            <dt>Remaining</dt>
            @if (overBudget()) {
              <dd class="font-semibold text-red-800" data-testid="remaining">Over budget by {{ overAmount() | money }}</dd>
            } @else {
              <dd class="font-semibold" data-testid="remaining">{{ b.totals.remaining | money }}</dd>
            }
          </div>
        </dl>
        @if (b.byCategory.length === 0) {
          <p class="text-muted" data-testid="no-categories">No expenses yet.</p>
        } @else {
          <div class="overflow-x-auto">
            <table data-testid="category-table">
              <thead>
                <tr><th>Category</th><th>Expenses</th><th>Committed</th><th>Paid</th><th>Outstanding</th><th>Share of committed</th></tr>
              </thead>
              <tbody>
                @for (c of b.byCategory; track c.category) {
                  <tr data-testid="category-row">
                    <td>{{ c.category }}</td>
                    <td>{{ c.expenseCount }}</td>
                    <td>{{ c.committed | money }}</td>
                    <td>{{ c.paid | money }}</td>
                    <td>{{ c.outstanding | money }}</td>
                    <td>
                      <div class="flex items-center gap-2">
                        <div class="progress w-24" aria-hidden="true"><span [style.width.%]="c.shareOfCommitted"></span></div>
                        <span class="text-sm">{{ c.shareOfCommitted }}%</span>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
})
export class ReportsPage implements OnInit {
  private readonly ctx = inject(WeddingContext);
  private readonly api = inject(DashboardService);

  readonly guests = signal<GuestReport | null>(null);
  readonly budget = signal<BudgetReport | null>(null);
  readonly error = signal<string | null>(null);
  readonly overBudget = computed(() => Number(this.budget()?.totals.remaining ?? 0) < 0);
  readonly overAmount = computed(() => String(this.budget()?.totals.remaining ?? '0').replace('-', ''));

  protected chip = (s: ReportInvitationStatus) => INVITATION_CHIP[s];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const id = this.ctx.wedding()?.id;
    if (!id) return;
    this.error.set(null);
    forkJoin({ g: this.api.getGuestReport(id), b: this.api.getBudgetReport(id) }).subscribe({
      next: ({ g, b }) => {
        this.guests.set(g);
        this.budget.set(b);
      },
      error: (e) => this.error.set(errorMessage(e)),
    });
  }

  downloadGuests(): void {
    const g = this.guests();
    if (g) downloadCsv(csvFilename(this.ctx.wedding()?.coupleNames ?? '', 'guests'), guestsCsv(g));
  }

  downloadBudget(): void {
    const b = this.budget();
    if (b) downloadCsv(csvFilename(this.ctx.wedding()?.coupleNames ?? '', 'budget'), budgetCsv(b));
  }

  print(): void {
    window.print();
  }
}
