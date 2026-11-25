import { DateOnlyPipe } from '../../core/pipes/date-only.pipe';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { applyServerFieldErrors, errorMessage, fieldError } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Member } from '../../core/models/wedding';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog.component';
import { MemberService } from './member.service';
import { WeddingContext } from './wedding-context.service';

import { FieldDirective } from '../../core/ui/field.directive';
@Component({
  selector: 'app-team-page',
  imports: [FieldDirective, ReactiveFormsModule, DateOnlyPipe, ConfirmDialogComponent],
  template: `
    <h1>Team</h1>
    @if (ctx.isArchived()) {
      <p class="alert alert-info" role="status">Archived — read-only. Adding members is disabled, but you can still revoke access.</p>
    }
    @if (actionError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

    @if (ctx.canEdit()) {
      <section class="card mb-4 max-w-2xl">
        <h2>Add team member</h2>
        <form [formGroup]="form" (ngSubmit)="add()" novalidate class="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div class="field mb-0 flex-1">
            <label class="label" for="memberEmail">Email of a registered planner</label>
            <input class="input" id="memberEmail" type="email" formControlName="email" [class.invalid]="err(form.controls.email, msgs)" />
            @if (err(form.controls.email, msgs); as e) { <span class="field-error">{{ e }}</span> }
          </div>
          <button class="btn btn-primary sm:mt-7" type="submit" [disabled]="adding()">{{ adding() ? 'Adding...' : 'Add team member' }}</button>
        </form>
      </section>
    }

    <section class="card overflow-x-auto">
      <h2>Members</h2>
      @if (loading()) {
        <p class="text-muted">Loading team...</p>
      } @else if (loadError(); as msg) {
        <p class="alert alert-danger" role="alert">{{ msg }}</p>
        <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
      } @else if (members().length === 0) {
        <p class="text-muted">No team members yet. Add a registered planner by email to give them read access.</p>
      } @else {
        <table class="min-w-[30rem]">
          <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Added</th><th></th></tr></thead>
          <tbody>
            @for (m of members(); track m.userId) {
              <tr>
                <td>{{ m.name }}</td>
                <td>{{ m.email }}</td>
                <td>
                  <span class="chip" [class.chip-success]="m.status === 'ACTIVE'" [class.chip-neutral]="m.status !== 'ACTIVE'">{{ m.status === 'ACTIVE' ? 'Active' : 'Revoked' }}</span>
                </td>
                <td>{{ m.addedAt | dateOnly }}</td>
                <td class="text-right">
                  @if (m.status === 'ACTIVE' && ctx.isOwner()) {
                    <button type="button" class="btn btn-secondary btn-sm" (click)="toRevoke.set(m)">Revoke</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    @if (toRevoke(); as m) {
      <app-confirm-dialog
        [title]="'Revoke access for ' + m.name + '?'"
        message="They lose access immediately; their tasks become unassigned."
        confirmLabel="Revoke access"
        [busy]="revoking()"
        (confirmed)="revoke(m)"
        (cancelled)="toRevoke.set(null)" />
    }
  `,
})
export class TeamPage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(MemberService);
  protected readonly ctx = inject(WeddingContext);

  readonly members = signal<Member[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly adding = signal(false);
  readonly toRevoke = signal<Member | null>(null);
  readonly revoking = signal(false);

  readonly form = this.fb.group({ email: ['', [Validators.required, Validators.email]] });
  readonly msgs = { required: 'Email is required.', email: 'Enter a valid email address.' };
  err = fieldError;

  constructor() {
    this.load();
  }

  private get weddingId(): string {
    return this.ctx.wedding()!.id;
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.list(this.weddingId).subscribe({
      next: (list) => {
        this.members.set(list);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        this.loadError.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  add(): void {
    this.actionError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.adding.set(true);
    this.api.add(this.weddingId, this.form.getRawValue().email.trim()).subscribe({
      next: () => {
        this.adding.set(false);
        this.form.reset({ email: '' });
        this.load();
      },
      error: (e: ApiError) => {
        this.adding.set(false);
        // Field errors show next to the input; other failures (409, 403) go in the alert.
        if (e?.error?.fields && Object.keys(e.error.fields).length > 0) {
          applyServerFieldErrors(this.form, e);
        } else {
          this.actionError.set(errorMessage(e));
        }
      },
    });
  }

  revoke(m: Member): void {
    this.revoking.set(true);
    this.actionError.set(null);
    this.api.revoke(this.weddingId, m.userId).subscribe({
      next: () => {
        this.revoking.set(false);
        this.toRevoke.set(null);
        this.load();
      },
      error: (e: ApiError) => {
        this.revoking.set(false);
        this.toRevoke.set(null);
        this.actionError.set(errorMessage(e));
      },
    });
  }
}
