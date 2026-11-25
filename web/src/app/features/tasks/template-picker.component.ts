import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { errorMessage } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { ChecklistTemplate } from '../../core/models/task';
import { PriorityChipComponent } from '../../core/ui/status-chips.component';
import { TaskService } from './task.service';

/** Lists the built-in checklist templates with a preview; applying copies them as tasks (FR-37). */
@Component({
  selector: 'app-template-picker',
  imports: [PriorityChipComponent],
  template: `
    <section class="card mb-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="mb-0">Apply a checklist template</h2>
        <button type="button" class="btn btn-secondary btn-sm" (click)="closed.emit()">Close</button>
      </div>
      <p class="mb-3 text-sm text-muted">Tasks are copied into this wedding as independent tasks; the template itself never changes.</p>
      @if (error(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
      @if (loading()) {
        <p class="text-muted">Loading templates...</p>
      } @else if (templates().length === 0 && !error()) {
        <p class="text-muted">No templates available.</p>
      } @else {
        <ul class="flex flex-col gap-3">
          @for (t of templates(); track t.id) {
            <li class="rounded-lg border border-line p-3">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="mr-auto">{{ t.name }}</strong>
                <span class="chip chip-neutral">{{ t.items.length }} tasks</span>
                <button type="button" class="btn btn-secondary btn-sm" (click)="toggle(t.id)">{{ open() === t.id ? 'Hide preview' : 'Preview' }}</button>
                <button type="button" class="btn btn-primary btn-sm" [disabled]="applying() !== null" (click)="apply(t)">
                  {{ applying() === t.id ? 'Applying...' : 'Apply' }}
                </button>
              </div>
              @if (t.description) { <p class="mt-1 mb-0 text-sm text-muted">{{ t.description }}</p> }
              @if (open() === t.id) {
                <ul class="mt-2 flex flex-col gap-1 text-sm">
                  @for (i of t.items; track i.id) {
                    <li class="flex flex-wrap items-center gap-2">
                      <app-priority-chip [priority]="i.priority" />
                      <span>{{ i.title }}</span>
                      <span class="text-muted">· {{ i.daysBeforeWedding }} days before</span>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class TemplatePickerComponent implements OnInit {
  private readonly api = inject(TaskService);
  readonly weddingId = input.required<string>();
  readonly applied = output<number>();
  readonly closed = output<void>();

  readonly templates = signal<ChecklistTemplate[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly open = signal<string | null>(null);
  readonly applying = signal<string | null>(null);

  ngOnInit(): void {
    this.api.templates().subscribe({
      next: (t) => {
        this.templates.set(t);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.error.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  toggle(id: string): void {
    this.open.set(this.open() === id ? null : id);
  }

  apply(t: ChecklistTemplate): void {
    this.applying.set(t.id);
    this.error.set(null);
    this.api.applyTemplate(this.weddingId(), t.id).subscribe({
      next: (r) => {
        this.applying.set(null);
        this.applied.emit(r.created.length);
      },
      error: (e: ApiError) => {
        this.applying.set(null);
        this.error.set(errorMessage(e));
      },
    });
  }
}
