import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { pickDirty, applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { ScheduleItem, ScheduleSaveResult } from '../../core/models/schedule';
import { FieldDirective } from '../../core/ui/field.directive';
import { isoToLocalInput, localInputToIso } from './schedule-time';
import { ScheduleService } from './schedule.service';

@Component({
  selector: 'app-schedule-form',
  imports: [ReactiveFormsModule, FieldDirective],
  template: `
    <form class="card mb-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <h2>{{ item() ? 'Edit schedule item' : 'Add schedule item' }}</h2>
      @if (formError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }
      <div class="field">
        <label class="label" for="schTitle">Title</label>
        <input class="input" id="schTitle" formControlName="title" [class.invalid]="err(form.controls.title)" />
        @if (err(form.controls.title); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      <div class="grid gap-x-4 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="schStart">Starts</label>
          <input class="input" id="schStart" type="datetime-local" formControlName="startTime" [class.invalid]="err(form.controls.startTime)" />
          @if (err(form.controls.startTime); as e) { <span class="field-error">{{ e }}</span> }
        </div>
        <div class="field">
          <label class="label" for="schEnd">Ends</label>
          <input class="input" id="schEnd" type="datetime-local" formControlName="endTime" [class.invalid]="err(form.controls.endTime)" />
          @if (err(form.controls.endTime); as e) { <span class="field-error">{{ e }}</span> }
        </div>
      </div>
      <div class="field">
        <label class="label" for="schLocation">Location (optional)</label>
        <input class="input" id="schLocation" formControlName="location" [class.invalid]="err(form.controls.location)" />
        @if (err(form.controls.location); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      <div class="field">
        <label class="label" for="schNotes">Notes (optional)</label>
        <textarea class="input" id="schNotes" rows="2" formControlName="notes" [class.invalid]="err(form.controls.notes)"></textarea>
        @if (err(form.controls.notes); as e) { <span class="field-error">{{ e }}</span> }
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
        <button class="btn btn-secondary" type="button" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
})
export class ScheduleFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(ScheduleService);

  readonly weddingId = input.required<string>();
  readonly item = input<ScheduleItem | null>(null);
  readonly saved = output<ScheduleSaveResult>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    startTime: ['', Validators.required],
    endTime: ['', Validators.required],
    location: ['', Validators.maxLength(200)],
    notes: ['', Validators.maxLength(2000)],
  });

  protected err = (c: Parameters<typeof fieldError>[0]) =>
    fieldError(c, { required: 'This field is required.', maxlength: 'This is too long.', order: 'End time must be after start time.' });

  ngOnInit(): void {
    const i = this.item();
    if (i) {
      this.form.patchValue({
        title: i.title,
        startTime: isoToLocalInput(i.startTime),
        endTime: isoToLocalInput(i.endTime),
        location: i.location ?? '',
        notes: i.notes ?? '',
      });
    }
  }

  submit(): void {
    this.formError.set(null);
    const { startTime, endTime } = this.form.controls;
    if (startTime.value && endTime.value && new Date(startTime.value) >= new Date(endTime.value)) {
      endTime.setErrors({ order: true });
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      title: v.title.trim(),
      startTime: localInputToIso(v.startTime),
      endTime: localInputToIso(v.endTime),
      location: v.location.trim(),
      notes: v.notes.trim(),
    };
    const i = this.item();
    const changes = i ? pickDirty(this.form, body) : body;
    if (i && Object.keys(changes).length === 0) {
      this.cancelled.emit();
      return;
    }
    this.saving.set(true);
    (i ? this.api.update(this.weddingId(), i.id, changes) : this.api.create(this.weddingId(), body)).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.saved.emit(r);
      },
      error: (e: ApiError) => {
        this.saving.set(false);
        if (e?.error?.fields && Object.keys(e.error.fields).length > 0) applyServerFieldErrors(this.form, e);
        else this.formError.set(errorMessage(e));
      },
    });
  }
}
