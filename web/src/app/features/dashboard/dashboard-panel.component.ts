import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/forms/server-errors';
import { Dashboard } from '../../core/models/dashboard';
import { DateOnlyPipe } from '../../core/pipes/date-only.pipe';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { BarSegment, StackedBarComponent } from '../../core/ui/stacked-bar.component';
import { PriorityChipComponent, TaskStatusChipComponent } from '../../core/ui/status-chips.component';
import { WeddingContext } from '../weddings/wedding-context.service';
import { countdownText } from './countdown';
import { DashboardService } from './dashboard.service';

/** Live wedding dashboard (FR-57..60). Created each time the Overview is visited, so it refetches. */
@Component({
  selector: 'app-dashboard-panel',
  imports: [RouterLink, DateOnlyPipe, MoneyPipe, StackedBarComponent, TaskStatusChipComponent, PriorityChipComponent],
  template: `
    @if (error(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary btn-sm" (click)="load()">Try again</button>
    } @else if (!data()) {
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="skeleton" aria-busy="true" aria-label="Loading dashboard">
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <div class="card h-28 animate-pulse bg-stone-50"></div>
        }
      </div>
    } @else if (data(); as d) {
      <p class="mt-4 text-lg" data-testid="countdown">
        The wedding {{ d.wedding.daysUntilWedding < 0 ? 'was' : 'is' }} <strong>{{ countdown() }}</strong> <span class="text-muted">({{ d.wedding.weddingDate | dateOnly }})</span>
      </p>

      @if (isEmpty()) {
        @if (ctx.canEdit()) {
          <section class="mt-4" data-testid="getting-started">
            <h2>Getting started</h2>
            <div class="grid gap-4 sm:grid-cols-3">
              <a class="card block no-underline hover:shadow-lift" [routerLink]="base('guests')">
                <strong class="block text-ink">Add guests</strong>
                <span class="text-sm text-muted">Build the guest list and send invitations.</span>
              </a>
              <a class="card block no-underline hover:shadow-lift" [routerLink]="base('tasks')">
                <strong class="block text-ink">Apply a checklist</strong>
                <span class="text-sm text-muted">Start from a ready-made planning checklist.</span>
              </a>
              <a class="card block no-underline hover:shadow-lift" [routerLink]="base('budget')">
                <strong class="block text-ink">Add expenses</strong>
                <span class="text-sm text-muted">Track what is agreed and what is paid.</span>
              </a>
            </div>
          </section>
        } @else {
          <p class="card mt-4 text-muted" data-testid="nothing-yet">Nothing has been planned for this wedding yet.</p>
        }
      } @else {
        <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="stat-cards">
          <a class="card block no-underline hover:shadow-lift" [routerLink]="base('guests')" data-testid="card-guests">
            <h2 class="!mb-1 !text-base">Guests</h2>
            <div class="text-2xl font-semibold text-ink">{{ d.guests.total }}</div>
            <div class="text-sm text-muted">
              {{ d.guests.accepted }} accepted · {{ d.guests.declined }} declined · {{ d.guests.pending }} pending
            </div>
            <div class="text-sm text-muted">Response rate {{ d.guests.responseRate }}%</div>
          </a>

          <a class="card block no-underline hover:shadow-lift" [routerLink]="base('tasks')" data-testid="card-tasks">
            <h2 class="!mb-1 !text-base">Tasks</h2>
            <div class="text-2xl font-semibold text-ink">{{ d.tasks.completed }} of {{ d.tasks.total }} done</div>
            <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
              @if (d.tasks.overdue > 0) { <span class="chip chip-danger">{{ d.tasks.overdue }} overdue</span> }
              <span>{{ d.tasks.dueNext7Days }} due in the next 7 days</span>
            </div>
            @if (d.tasks.myOpenTasks > 0) {
              <div class="text-sm text-muted">{{ d.tasks.myOpenTasks }} assigned to you</div>
            }
          </a>

          <a class="card block no-underline hover:shadow-lift" [routerLink]="base('budget')" data-testid="card-budget">
            <h2 class="!mb-1 !text-base">Budget</h2>
            <div class="text-2xl font-semibold text-ink">{{ d.budget.committed | money }} <span class="text-sm font-normal text-muted">of {{ d.budget.totalBudget | money }}</span></div>
            <div class="text-sm text-muted">Paid {{ d.budget.paid | money }} · Outstanding {{ d.budget.outstanding | money }}</div>
            @if (overBudget()) {
              <div class="text-sm font-semibold text-red-800" data-testid="remaining">Over budget by {{ overAmount() | money }}</div>
            } @else {
              <div class="text-sm text-muted" data-testid="remaining">Remaining {{ d.budget.remaining | money }}</div>
            }
            @if (d.budget.overdueExpenseCount > 0) {
              <span class="chip chip-danger mt-1">{{ d.budget.overdueExpenseCount }} overdue payment{{ d.budget.overdueExpenseCount === 1 ? '' : 's' }}</span>
            }
          </a>

          <a class="card block no-underline hover:shadow-lift" [routerLink]="base('suppliers')" data-testid="card-suppliers">
            <h2 class="!mb-1 !text-base">Suppliers</h2>
            <div class="text-2xl font-semibold text-ink">{{ d.suppliers.total }}</div>
          </a>

          <a class="card block no-underline hover:shadow-lift" [routerLink]="base('schedule')" data-testid="card-schedule">
            <h2 class="!mb-1 !text-base">Schedule</h2>
            <div class="text-2xl font-semibold text-ink">{{ d.schedule.items }} item{{ d.schedule.items === 1 ? '' : 's' }}</div>
            @if (d.schedule.overlappingItems > 0) {
              <span class="chip chip-warning">{{ d.schedule.overlappingItems }} overlapping</span>
            }
          </a>
        </div>

        <section class="card mt-4" aria-labelledby="charts-h">
          <h2 id="charts-h">At a glance</h2>
          <div class="grid gap-6 lg:grid-cols-3">
            <app-stacked-bar title="RSVP responses" [segments]="rsvpBar()" />
            <app-stacked-bar title="Task progress" [segments]="taskBar()" />
            <app-stacked-bar title="Budget" [segments]="budgetBar()" />
          </div>
        </section>

        <section class="card mt-4" aria-labelledby="inv-h">
          <h2 id="inv-h">Invitations</h2>
          <p class="mb-0 text-sm" data-testid="invitations">
            {{ d.guests.invitations.notSent }} not sent · {{ d.guests.invitations.sent }} sent ·
            {{ d.guests.invitations.failed }} failed · {{ d.guests.invitations.revoked }} revoked
            @if (d.guests.invitations.failed > 0) {
              <a class="ml-2 font-medium" [routerLink]="base('guests')">Review failed invitations</a>
            }
          </p>
        </section>

        <section class="mt-4" aria-labelledby="up-h">
          <div class="mb-3 flex items-center justify-between">
            <h2 id="up-h" class="!mb-0">Upcoming tasks</h2>
            <a [routerLink]="base('tasks')">View all tasks</a>
          </div>
          @if (d.upcomingTasks.length === 0) {
            <p class="text-muted" data-testid="no-upcoming">No unfinished tasks. Nice work!</p>
          } @else {
            <ul class="flex flex-col gap-2">
              @for (t of d.upcomingTasks; track t.id) {
                <li class="row-card" [class.highlight]="t.isOverdue" data-testid="upcoming-task">
                  <div class="min-w-0 flex-1">
                    <div class="font-medium">{{ t.title }}</div>
                    <div class="text-sm text-muted">
                      Due {{ t.dueDate | dateOnly }} · {{ t.assignee ? t.assignee.name : 'Unassigned' }}
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    @if (t.isOverdue) { <span class="chip chip-danger">Overdue</span> }
                    <app-task-status-chip [status]="t.status" />
                    <app-priority-chip [priority]="t.priority" />
                  </div>
                </li>
              }
            </ul>
          }
        </section>
      }
    }
  `,
})
export class DashboardPanelComponent implements OnInit {
  protected readonly ctx = inject(WeddingContext);
  private readonly api = inject(DashboardService);

  readonly weddingId = input.required<string>();
  readonly data = signal<Dashboard | null>(null);
  readonly error = signal<string | null>(null);

  readonly countdown = computed(() => countdownText(this.data()?.wedding.daysUntilWedding ?? 0));
  readonly overBudget = computed(() => Number(this.data()?.budget.remaining ?? 0) < 0);
  readonly overAmount = computed(() => String(this.data()?.budget.remaining ?? '0').replace('-', ''));
  readonly isEmpty = computed(() => {
    const d = this.data();
    return (
      !!d &&
      d.guests.total === 0 &&
      d.tasks.total === 0 &&
      Number(d.budget.committed) === 0 &&
      d.budget.overdueExpenseCount === 0 &&
      d.suppliers.total === 0 &&
      d.schedule.items === 0
    );
  });

  readonly rsvpBar = computed<BarSegment[]>(() => {
    const g = this.data()?.guests;
    if (!g) return [];
    return [
      { label: 'Accepted', value: g.accepted, display: String(g.accepted), color: 'bg-sage-700' },
      { label: 'Declined', value: g.declined, display: String(g.declined), color: 'bg-red-600' },
      { label: 'Pending', value: g.pending, display: String(g.pending), color: 'bg-amber-700' },
    ];
  });

  readonly taskBar = computed<BarSegment[]>(() => {
    const t = this.data()?.tasks;
    if (!t) return [];
    return [
      { label: 'Completed', value: t.completed, display: String(t.completed), color: 'bg-sage-700' },
      { label: 'In progress', value: t.inProgress, display: String(t.inProgress), color: 'bg-sky-700' },
      { label: 'To do', value: t.todo, display: String(t.todo), color: 'bg-stone-500' },
    ];
  });

  readonly budgetBar = computed<BarSegment[]>(() => {
    const b = this.data()?.budget;
    if (!b) return [];
    const money = (v: string) => new MoneyPipe().transform(v);
    const paid = Number(b.paid);
    const out = Number(b.outstanding);
    const over = this.overBudget() ? Number(this.overAmount()) : 0;
    // Bar spans committed; its last `over` part is the overspend, so shrink the other widths to make room.
    const outW = Math.max(0, out - over);
    const paidW = Math.max(0, paid - Math.max(0, over - out));
    const segs: BarSegment[] = [
      { label: 'Paid', value: paid, width: paidW, display: money(b.paid), color: 'bg-sage-700' },
      { label: 'Outstanding', value: out, width: outW, display: money(b.outstanding), color: 'bg-amber-700' },
    ];
    segs.push(
      over > 0
        ? { label: 'Over budget by', value: over, width: over, display: money(this.overAmount()), color: 'bg-red-600' }
        : { label: 'Remaining', value: Number(b.remaining), display: money(b.remaining), color: 'bg-rose-500' },
    );
    return segs;
  });

  ngOnInit(): void {
    this.load();
  }

  base(section: string): string[] {
    return ['/weddings', this.weddingId(), section];
  }

  load(): void {
    this.error.set(null);
    this.data.set(null);
    this.api.getDashboard(this.weddingId()).subscribe({
      next: (d) => this.data.set(d),
      error: (e) => this.error.set(errorMessage(e)),
    });
  }
}
