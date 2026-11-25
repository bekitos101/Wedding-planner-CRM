import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { pickDirty, applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Task, TaskPriority, TaskStatus } from '../../core/models/task';
import { FieldDirective } from '../../core/ui/field.directive';
import { TaskService } from './task.service';

export interface AssigneeOption {
  id: string;
  name: string;
}

/**
 * Task form. `full` = owner (every field); `member` = team member on an assigned task: ONLY status
 * and progress notes are rendered and sent (AC-03, BR-03).
 */
@Component({
  selector: 'app-task-form',
  imports: [ReactiveFormsModule, FieldDirective],
  template: `
    <form class="card mb-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <h2>{{ mode() === 'member' ? 'Update “' + task()?.title + '”' : task() ? 'Edit task' : 'New task' }}</h2>
      @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

      @if (mode() === 'full') {
        <div class="field">
          <label class="label" for="taskTitle">Title</label>
          <input class="input" id="taskTitle" formControlName="title" [class.invalid]="err(form.controls.title)" />
          @if (err(form.controls.title); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="taskDescription">Description (optional)</label>
          <textarea class="input" id="taskDescription" rows="2" formControlName="description" [class.invalid]="err(form.controls.description)"></textarea>
          @if (err(form.controls.description); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="grid gap-x-4 sm:grid-cols-2">
          <div class="field">
            <label class="label" for="taskDue">Due date</label>
            <input class="input" id="taskDue" type="date" formControlName="dueDate" [class.invalid]="err(form.controls.dueDate)" />
            @if (err(form.controls.dueDate); as e) { <span class="field-error">{{ e }}</span> }
          </div>
          <div class="field">
            <label class="label" for="taskPriority">Priority</label>
            <select class="input" id="taskPriority" formControlName="priority">
              <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
            </select>
          </div>
          <div class="field">
            <label class="label" for="taskAssignee">Assignee</label>
            <select class="input" id="taskAssignee" formControlName="assigneeId" [class.invalid]="err(form.controls.assigneeId)">
              <option value="">Unassigned</option>
              @for (a of assignees(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
            </select>
            @if (err(form.controls.assigneeId); as e) { <span class="field-error">{{ e }}</span> }
          </div>
        </div>
      }

      <div class="field">
        <label class="label" for="taskStatus">Status</label>
        <select class="input" id="taskStatus" formControlName="status" [class.invalid]="err(form.controls.status)">
          <option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option>
        </select>
        @if (err(form.controls.status); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      @if (mode() === 'member' || task()) {
        <div class="field">
          <label class="label" for="taskNotes">Progress notes</label>
          <textarea class="input" id="taskNotes" rows="3" formControlName="progressNotes" [class.invalid]="err(form.controls.progressNotes)"></textarea>
          @if (err(form.controls.progressNotes); as e) { <span class="field-error">{{ e }}</span> }
        </div>
      }

      <div class="flex gap-2">
        <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
        <button class="btn btn-secondary" type="button" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
})
export class TaskFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(TaskService);

  readonly weddingId = input.required<string>();
  readonly mode = input<'full' | 'member'>('full');
  readonly task = input<Task | null>(null);
  readonly assignees = input<AssigneeOption[]>([]);
  readonly saved = output<Task>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: ['', Validators.maxLength(2000)],
    dueDate: ['', Validators.required],
    priority: ['MEDIUM' as TaskPriority],
    status: ['TODO' as TaskStatus],
    assigneeId: [''],
    progressNotes: ['', Validators.maxLength(2000)],
  });

  protected err = (c: Parameters<typeof fieldError>[0]) =>
    fieldError(c, { required: 'This field is required.', maxlength: 'This is too long.' });

  ngOnInit(): void {
    const t = this.task();
    if (t) {
      this.form.patchValue({
        title: t.title,
        description: t.description ?? '',
        dueDate: t.dueDate,
        priority: t.priority,
        status: t.status,
        assigneeId: t.assignee?.id ?? '',
        progressNotes: t.progressNotes ?? '',
      });
    }
    if (this.mode() === 'member') {
      for (const k of ['title', 'dueDate'] as const) this.form.controls[k].disable();
    }
  }

  submit(): void {
    this.formError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const t = this.task();
    this.saving.set(true);

    let req;
    if (this.mode() === 'member') {
      // Only these two keys; anything else is rejected with 403 (BR-03).
      const changes = pickDirty(this.form, { status: v.status, progressNotes: v.progressNotes });
      if (Object.keys(changes).length === 0) {
        this.saving.set(false);
        this.cancelled.emit();
        return;
      }
      req = this.api.update(this.weddingId(), t!.id, changes);
    } else {
      const body = {
        title: v.title.trim(),
        description: v.description.trim(),
        dueDate: v.dueDate,
        priority: v.priority,
        status: v.status,
        assigneeId: v.assigneeId || null,
        progressNotes: v.progressNotes,
      };
      const changes = t ? pickDirty(this.form, body) : (({ progressNotes: _p, ...rest }) => rest)(body);
      if (t && Object.keys(changes).length === 0) {
        this.saving.set(false);
        this.cancelled.emit();
        return;
      }
      req = t ? this.api.update(this.weddingId(), t.id, changes) : this.api.create(this.weddingId(), body);
    }
    req.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit(saved);
      },
      error: (e: ApiError) => {
        this.saving.set(false);
        if (e?.error?.fields && Object.keys(e.error.fields).length > 0) applyServerFieldErrors(this.form, e);
        else this.formError.set(errorMessage(e));
      },
    });
  }
}
