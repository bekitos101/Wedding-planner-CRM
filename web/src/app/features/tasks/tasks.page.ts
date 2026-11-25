import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { errorMessage } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Task, TaskFilters, TaskStatus } from '../../core/models/task';
import { DateOnlyPipe } from '../../core/pipes/date-only.pipe';
import { ArchivedNoteComponent } from '../../core/ui/archived-note.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog.component';
import { PriorityChipComponent, TaskStatusChipComponent } from '../../core/ui/status-chips.component';
import { MemberService } from '../weddings/member.service';
import { WeddingContext } from '../weddings/wedding-context.service';
import { AssigneeOption, TaskFormComponent } from './task-form.component';
import { TaskService } from './task.service';
import { TemplatePickerComponent } from './template-picker.component';

@Component({
  selector: 'app-tasks-page',
  imports: [
    FormsModule, DateOnlyPipe, ConfirmDialogComponent, ArchivedNoteComponent, PriorityChipComponent,
    TaskStatusChipComponent, TaskFormComponent, TemplatePickerComponent,
  ],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="mb-0 mr-auto">Tasks</h1>
      @if (ctx.canEdit()) {
        <button type="button" class="btn btn-secondary btn-sm" (click)="showTemplates.set(true); editing.set(null); creating.set(false)">Apply checklist template</button>
        <button type="button" class="btn btn-primary btn-sm" (click)="creating.set(true); editing.set(null); showTemplates.set(false)">New task</button>
      }
    </div>
    @if (ctx.isArchived()) { <app-archived-note /> }
    @if (notice(); as msg) { <p class="alert alert-success" role="status">{{ msg }}</p> }
    @if (actionError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

    @if (showTemplates() && ctx.canEdit()) {
      <app-template-picker [weddingId]="weddingId()" (applied)="onApplied($event)" (closed)="showTemplates.set(false)" />
    }
    @if (creating() && ctx.canEdit()) {
      <app-task-form [weddingId]="weddingId()" [assignees]="assignees()" (saved)="onSaved()" (cancelled)="creating.set(false)" />
    }
    @if (editing(); as t) {
      <app-task-form [weddingId]="weddingId()" [task]="t" [mode]="ctx.canEdit() ? 'full' : 'member'"
        [assignees]="assignees()" (saved)="onSaved()" (cancelled)="editing.set(null)" />
    }

    <section class="card mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" aria-label="Filters">
      <div>
        <label class="label" for="fAssignee">Show</label>
        <select class="input" id="fAssignee" [ngModel]="scope()" (ngModelChange)="scope.set($event); load()">
          <option value="">All tasks</option><option value="me">My tasks</option><option value="unassigned">Unassigned</option>
        </select>
      </div>
      <div>
        <label class="label" for="fStatus">Status</label>
        <select class="input" id="fStatus" [ngModel]="status()" (ngModelChange)="status.set($event); load()">
          <option value="">Any status</option><option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option>
        </select>
      </div>
      <label class="flex items-center gap-2 text-sm sm:pb-2.5">
        <input type="checkbox" [ngModel]="overdue()" (ngModelChange)="overdue.set($event); load()" /> Overdue only
      </label>
    </section>

    @if (loading()) {
      <p class="text-muted">Loading tasks...</p>
    } @else if (loadError(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
    } @else if (tasks().length === 0) {
      <section class="card text-center">
        <p class="py-6 text-muted">{{ filtered() ? 'No tasks match these filters.' : 'No tasks yet.' }}</p>
        @if (ctx.canEdit() && !filtered()) {
          <button type="button" class="btn btn-primary" (click)="creating.set(true)">Add the first task</button>
        }
      </section>
    } @else {
      <ul class="flex flex-col gap-3">
        @for (t of tasks(); track t.id) {
          <li class="row-card" [class.highlight]="t.isOverdue" data-testid="task-row">
            <div class="min-w-0 flex-1">
              <div class="font-medium">{{ t.title }}</div>
              <div class="text-sm text-muted">
                Due {{ t.dueDate | dateOnly }} · {{ t.assignee ? t.assignee.name : 'Unassigned' }}
              </div>
              @if (t.progressNotes) { <div class="mt-1 text-sm">{{ t.progressNotes }}</div> }
            </div>
            <div class="flex flex-wrap items-center gap-2">
              @if (t.isOverdue) { <span class="chip chip-danger">Overdue</span> }
              <app-priority-chip [priority]="t.priority" />
              @if (ctx.canEdit()) {
                <select class="input !w-auto !py-1 text-sm" [attr.aria-label]="'Status of ' + t.title" [ngModel]="t.status" (ngModelChange)="changeStatus(t, $event)">
                  <option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option>
                </select>
              } @else {
                <app-task-status-chip [status]="t.status" />
              }
            </div>
            <div class="flex gap-2">
              @if (ctx.canEdit()) {
                <button type="button" class="btn btn-secondary btn-sm" (click)="startEdit(t)">Edit</button>
                <button type="button" class="btn btn-secondary btn-sm" (click)="toDelete.set(t)">Delete</button>
              } @else if (isMine(t) && !ctx.isOwner() && !ctx.isArchived()) {
                <button type="button" class="btn btn-secondary btn-sm" (click)="startEdit(t)">Update progress</button>
              }
            </div>
          </li>
        }
      </ul>
    }

    @if (toDelete(); as t) {
      <app-confirm-dialog title="Delete this task?" [message]="'“' + t.title + '” will be removed permanently.'"
        confirmLabel="Delete task" [busy]="deleting()" (confirmed)="remove(t)" (cancelled)="toDelete.set(null)" />
    }
  `,
})
export class TasksPage {
  protected readonly ctx = inject(WeddingContext);
  private readonly api = inject(TaskService);
  private readonly members = inject(MemberService);
  private readonly auth = inject(AuthService);

  readonly weddingId = computed(() => this.ctx.wedding()!.id);
  readonly tasks = signal<Task[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly scope = signal<'' | 'me' | 'unassigned'>('');
  readonly status = signal<'' | TaskStatus>('');
  readonly overdue = signal(false);
  readonly filtered = computed(() => !!(this.scope() || this.status() || this.overdue()));

  readonly creating = signal(false);
  readonly editing = signal<Task | null>(null);
  readonly showTemplates = signal(false);
  readonly toDelete = signal<Task | null>(null);
  readonly deleting = signal(false);
  readonly assignees = signal<AssigneeOption[]>([]);

  /** Only the latest list request may update the page (slow older responses are ignored). */
  private loadSeq = 0;

  constructor() {
    this.load();
    this.loadAssignees();
  }

  isMine(t: Task): boolean {
    const me = this.auth.currentUser();
    return !!me && t.assignee?.id === me.id;
  }

  private loadAssignees(): void {
    const w = this.ctx.wedding();
    if (!w) return;
    const owner: AssigneeOption = { id: w.owner.id, name: w.owner.name };
    this.assignees.set([owner]);
    if (!this.ctx.isOwner()) return; // members can't list members and never assign
    this.members.list(w.id).subscribe({
      next: (list) =>
        this.assignees.set([owner, ...list.filter((m) => m.status === 'ACTIVE').map((m) => ({ id: m.userId, name: m.name }))]),
      error: () => undefined,
    });
  }

  load(): void {
    const filters: TaskFilters = {};
    if (this.scope()) filters.assignee = this.scope() as 'me' | 'unassigned';
    if (this.status()) filters.status = this.status() as TaskStatus;
    if (this.overdue()) filters.overdue = true;
    this.loading.set(true);
    this.loadError.set(null);
    const seq = ++this.loadSeq;
    this.api.list(this.weddingId(), filters).subscribe({
      next: (list) => {
        if (seq !== this.loadSeq) return; // a newer request superseded this one
        this.tasks.set(list);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        if (seq !== this.loadSeq) return;
        this.loadError.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  startEdit(t: Task): void {
    this.editing.set(t);
    this.creating.set(false);
    this.showTemplates.set(false);
  }

  onSaved(): void {
    this.creating.set(false);
    this.editing.set(null);
    this.notice.set('Task saved.');
    this.load();
  }

  onApplied(count: number): void {
    this.showTemplates.set(false);
    this.notice.set(`${count} ${count === 1 ? 'task' : 'tasks'} added`);
    this.load();
  }

  changeStatus(t: Task, status: TaskStatus): void {
    if (status === t.status) return;
    this.actionError.set(null);
    this.api.update(this.weddingId(), t.id, { status }).subscribe({
      next: () => this.load(),
      error: (e: ApiError) => {
        this.actionError.set(errorMessage(e));
        this.load();
      },
    });
  }

  remove(t: Task): void {
    this.deleting.set(true);
    this.api.remove(this.weddingId(), t.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.toDelete.set(null);
        this.notice.set('Task deleted.');
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
