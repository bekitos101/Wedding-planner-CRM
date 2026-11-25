import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { errorMessage } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { ScheduleItem, ScheduleSaveResult, ScheduleWarning } from '../../core/models/schedule';
import { ArchivedNoteComponent } from '../../core/ui/archived-note.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog.component';
import { WeddingContext } from '../weddings/wedding-context.service';
import { ScheduleFormComponent } from './schedule-form.component';
import { ScheduleService } from './schedule.service';

interface DayGroup {
  key: string;
  items: ScheduleItem[];
}

@Component({
  selector: 'app-schedule-page',
  imports: [DatePipe, ArchivedNoteComponent, ConfirmDialogComponent, ScheduleFormComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="mb-0 mr-auto">Schedule</h1>
      @if (ctx.canEdit()) {
        <button type="button" class="btn btn-primary btn-sm" (click)="creating.set(true); editing.set(null)">Add item</button>
      }
    </div>
    @if (ctx.isArchived()) { <app-archived-note /> }
    @if (notice(); as msg) { <p class="alert alert-success" role="status">{{ msg }}</p> }
    @if (warnings().length > 0) {
      <div class="alert alert-warning flex items-start justify-between gap-3" role="alert" data-testid="warnings">
        <p class="mb-0">Saved. {{ warningText() }}</p>
        <button type="button" class="btn btn-secondary btn-sm" aria-label="Dismiss warning" (click)="warnings.set([])">Dismiss</button>
      </div>
    }
    @if (actionError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

    @if (creating() && ctx.canEdit()) {
      <app-schedule-form [weddingId]="weddingId()" (saved)="onSaved($event)" (cancelled)="creating.set(false)" />
    }
    @if (editing(); as i) {
      <app-schedule-form [weddingId]="weddingId()" [item]="i" (saved)="onSaved($event)" (cancelled)="editing.set(null)" />
    }

    @if (loading()) {
      <p class="text-muted">Loading schedule...</p>
    } @else if (loadError(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
    } @else if (items().length === 0) {
      <section class="card text-center">
        <p class="py-6 text-muted">Nothing scheduled yet.</p>
        @if (ctx.canEdit()) { <button type="button" class="btn btn-primary" (click)="creating.set(true)">Add the first item</button> }
      </section>
    } @else {
      @for (day of days(); track day.key) {
        <section class="mb-5">
          <h2 class="mb-2">{{ day.items[0].startTime | date: 'EEEE, d MMMM y' }}</h2>
          <ol class="flex flex-col gap-3">
            @for (i of day.items; track i.id) {
              <li class="row-card" [class.highlight]="i.overlapsWith.length > 0" data-testid="schedule-item">
                <div class="font-medium tabular-nums sm:w-36">
                  {{ i.startTime | date: 'HH:mm' }}–{{ i.endTime | date: 'HH:mm' }}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="font-medium">{{ i.title }}</div>
                  @if (i.location) { <div class="text-sm text-muted">{{ i.location }}</div> }
                  @if (i.notes) { <div class="text-sm">{{ i.notes }}</div> }
                  @if (i.overlapsWith.length > 0) {
                    <div class="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span class="chip chip-warning">Overlaps</span>
                      <span class="text-amber-900">with {{ overlapTitles(i) }}</span>
                    </div>
                  }
                </div>
                @if (ctx.canEdit()) {
                  <div class="flex gap-2">
                    <button type="button" class="btn btn-secondary btn-sm" (click)="editing.set(i); creating.set(false)">Edit</button>
                    <button type="button" class="btn btn-secondary btn-sm" (click)="toDelete.set(i)">Delete</button>
                  </div>
                }
              </li>
            }
          </ol>
        </section>
      }
    }

    @if (toDelete(); as i) {
      <app-confirm-dialog title="Delete this item?" [message]="'“' + i.title + '” will be removed from the schedule.'"
        confirmLabel="Delete item" [busy]="deleting()" (confirmed)="remove(i)" (cancelled)="toDelete.set(null)" />
    }
  `,
})
export class SchedulePage {
  protected readonly ctx = inject(WeddingContext);
  private readonly api = inject(ScheduleService);

  readonly weddingId = computed(() => this.ctx.wedding()!.id);
  readonly items = signal<ScheduleItem[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly warnings = signal<ScheduleWarning[]>([]);
  readonly creating = signal(false);
  readonly editing = signal<ScheduleItem | null>(null);
  readonly toDelete = signal<ScheduleItem | null>(null);
  readonly deleting = signal(false);

  readonly warningText = computed(() => this.warnings().map((w) => w.message).join(' '));

  /** Items arrive chronologically; group them by local calendar day. */
  readonly days = computed<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const i of this.items()) {
      const d = new Date(i.startTime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const last = groups[groups.length - 1];
      if (last?.key === key) last.items.push(i);
      else groups.push({ key, items: [i] });
    }
    return groups;
  });

  constructor() {
    this.load();
  }

  overlapTitles(i: ScheduleItem): string {
    const byId = new Map(this.items().map((x) => [x.id, x.title]));
    return i.overlapsWith.map((id) => `“${byId.get(id) ?? 'another item'}”`).join(', ');
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.list(this.weddingId()).subscribe({
      next: (list) => {
        this.items.set(list);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.loadError.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  onSaved(r: ScheduleSaveResult): void {
    this.creating.set(false);
    this.editing.set(null);
    this.warnings.set(r.warnings ?? []);
    this.notice.set(r.warnings?.length ? null : 'Schedule item saved.');
    this.load();
  }

  remove(i: ScheduleItem): void {
    this.deleting.set(true);
    this.api.remove(this.weddingId(), i.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.toDelete.set(null);
        this.warnings.set([]);
        this.notice.set('Schedule item deleted.');
        this.load();
      },
      error: (e: ApiError) => {
        this.deleting.set(false);
        this.toDelete.set(null);
        this.actionError.set(errorMessage(e));
      },
    });
  }
}
