import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { errorMessage } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Guest, GuestSummary, RsvpStatus } from '../../core/models/guest';
import { ArchivedNoteComponent } from '../../core/ui/archived-note.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog.component';
import { RsvpChipComponent } from '../../core/ui/status-chips.component';
import { WeddingContext } from '../weddings/wedding-context.service';
import { GuestFormComponent } from './guest-form.component';
import { GuestService } from './guest.service';
import { invitationChip } from './invitation-status';

type Pending = { kind: 'delete' | 'resend' | 'revoke'; guest: Guest };

@Component({
  selector: 'app-guests-page',
  imports: [
    DatePipe, FormsModule, ReactiveFormsModule, ArchivedNoteComponent, ConfirmDialogComponent,
    RsvpChipComponent, GuestFormComponent,
  ],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="mb-0 mr-auto">Guests</h1>
      @if (ctx.canEdit()) {
        <button type="button" class="btn btn-primary btn-sm" (click)="creating.set(true); editing.set(null)">Add guest</button>
      }
    </div>
    @if (ctx.isArchived()) { <app-archived-note /> }
    @if (notice(); as msg) { <p class="alert alert-success" role="status">{{ msg }}</p> }
    @if (warning(); as msg) { <p class="alert alert-warning" role="alert">{{ msg }}</p> }
    @if (actionError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

    @if (creating() && ctx.canEdit()) {
      <app-guest-form [weddingId]="weddingId()" (saved)="onSaved('Guest added.')" (cancelled)="creating.set(false)" />
    }
    @if (editing(); as g) {
      <app-guest-form [weddingId]="weddingId()" [guest]="g" (saved)="onSaved('Guest saved.')" (cancelled)="editing.set(null)" />
    }

    <div class="mb-4 flex flex-wrap gap-2" aria-label="Guest summary" data-testid="summary">
      <span class="chip chip-neutral">{{ summary().total }} total</span>
      <span class="chip chip-success">{{ summary().accepted }} accepted</span>
      <span class="chip chip-danger">{{ summary().declined }} declined</span>
      <span class="chip chip-warning">{{ summary().pending }} pending</span>
    </div>

    <section class="card mb-4 flex flex-col gap-3 sm:flex-row sm:items-end" aria-label="Filters">
      <div class="flex-1">
        <label class="label" for="guestSearch">Search</label>
        <input class="input" id="guestSearch" type="search" placeholder="Name or email" [formControl]="search" />
      </div>
      <div>
        <label class="label" for="guestFilter">RSVP</label>
        <select class="input" id="guestFilter" [ngModel]="rsvp()" (ngModelChange)="rsvp.set($event); load()">
          <option value="">All answers</option><option value="PENDING">Pending</option><option value="ACCEPTED">Accepted</option><option value="DECLINED">Declined</option>
        </select>
      </div>
    </section>

    @if (loading()) {
      <p class="text-muted">Loading guests...</p>
    } @else if (loadError(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
    } @else if (guests().length === 0) {
      <section class="card text-center">
        <p class="py-6 text-muted">{{ filtered() ? 'No guests match your search.' : 'No guests yet.' }}</p>
        @if (ctx.canEdit() && !filtered()) {
          <button type="button" class="btn btn-primary" (click)="creating.set(true)">Add the first guest</button>
        }
      </section>
    } @else {
      <ul class="flex flex-col gap-3">
        @for (g of guests(); track g.id) {
          @let chip = chipFor(g);
          <li class="row-card sm:items-start" data-testid="guest-row">
            <div class="min-w-0 flex-1">
              <div class="font-medium">{{ g.name }}</div>
              <div class="truncate text-sm text-muted">{{ g.email }}</div>
              @if (g.dietaryRequirements) { <div class="mt-1 text-sm">Diet: {{ g.dietaryRequirements }}</div> }
            </div>
            <div class="flex flex-col items-start gap-1 sm:w-48">
              <app-rsvp-chip [status]="g.rsvpStatus" />
              <span class="chip invitation-chip" [class]="chip.cls" [attr.title]="chip.detail">Invitation: {{ chip.label }}</span>
              @if (chip.detail) { <span class="text-xs text-red-700">{{ chip.detail }}</span> }
              @if (g.invitation?.lastSentAt) {
                <span class="text-xs text-muted">Last sent {{ g.invitation!.lastSentAt | date: 'd MMM y, HH:mm' }}</span>
              }
            </div>
            @if (ctx.canEdit()) {
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-primary btn-sm" [disabled]="busyId() === g.id" (click)="send(g)">
                  {{ g.invitation && g.invitation.status !== 'REVOKED' ? 'Resend' : 'Send invitation' }}
                </button>
                @if (g.invitation && g.invitation.status !== 'REVOKED') {
                  <button type="button" class="btn btn-secondary btn-sm" (click)="pending.set({ kind: 'revoke', guest: g })">Revoke link</button>
                }
                <button type="button" class="btn btn-secondary btn-sm" (click)="editing.set(g); creating.set(false)">Edit</button>
                <button type="button" class="btn btn-secondary btn-sm" (click)="pending.set({ kind: 'delete', guest: g })">Delete</button>
              </div>
            }
          </li>
        }
      </ul>
    }

    @if (pending(); as p) {
      @switch (p.kind) {
        @case ('delete') {
          <app-confirm-dialog title="Delete this guest?" [message]="p.guest.name + ' and their invitation link will be removed.'"
            confirmLabel="Delete guest" [busy]="working()" (confirmed)="confirm(p)" (cancelled)="pending.set(null)" />
        }
        @case ('resend') {
          <app-confirm-dialog title="Resend the invitation?" message="The previous link will stop working."
            confirmLabel="Resend" [busy]="working()" (confirmed)="confirm(p)" (cancelled)="pending.set(null)" />
        }
        @case ('revoke') {
          <app-confirm-dialog title="Revoke this invitation link?" [message]="p.guest.name + ' will no longer be able to answer with the current link.'"
            confirmLabel="Revoke link" [busy]="working()" (confirmed)="confirm(p)" (cancelled)="pending.set(null)" />
        }
      }
    }
  `,
})
export class GuestsPage {
  protected readonly ctx = inject(WeddingContext);
  private readonly api = inject(GuestService);

  readonly weddingId = computed(() => this.ctx.wedding()!.id);
  readonly guests = signal<Guest[]>([]);
  readonly summary = signal<GuestSummary>({ total: 0, pending: 0, accepted: 0, declined: 0 });
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly warning = signal<string | null>(null);

  readonly search = new FormControl('', { nonNullable: true });
  readonly rsvp = signal<'' | RsvpStatus>('');
  readonly filtered = computed(() => !!this.rsvp() || !!this.searchText());
  private readonly searchText = signal('');

  readonly creating = signal(false);
  readonly editing = signal<Guest | null>(null);
  readonly pending = signal<Pending | null>(null);
  readonly working = signal(false);
  readonly busyId = signal<string | null>(null);

  /** Only the latest list request may update the page (slow older responses are ignored). */
  private loadSeq = 0;

  constructor() {
    this.load();
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((v) => {
        this.searchText.set(v.trim());
        this.load();
      });
  }

  chipFor = (g: Guest) => invitationChip(g.invitation);

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    const seq = ++this.loadSeq;
    this.api.list(this.weddingId(), this.searchText(), this.rsvp()).subscribe({
      next: (r) => {
        if (seq !== this.loadSeq) return;
        this.guests.set(r.guests);
        this.summary.set(r.summary);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        if (seq !== this.loadSeq) return;
        this.loadError.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  private clearMessages(): void {
    this.notice.set(null);
    this.warning.set(null);
    this.actionError.set(null);
  }

  onSaved(msg: string): void {
    this.creating.set(false);
    this.editing.set(null);
    this.clearMessages();
    this.notice.set(msg);
    this.load();
  }

  /** Resending needs a confirmation because the previous link stops working. */
  send(g: Guest): void {
    if (g.invitation && g.invitation.status !== 'REVOKED') this.pending.set({ kind: 'resend', guest: g });
    else this.doSend(g);
  }

  confirm(p: Pending): void {
    if (p.kind === 'resend') this.doSend(p.guest);
    else if (p.kind === 'revoke') this.doRevoke(p.guest);
    else this.doDelete(p.guest);
  }

  private doSend(g: Guest): void {
    this.clearMessages();
    this.working.set(true);
    this.busyId.set(g.id);
    this.api.sendInvitation(this.weddingId(), g.id).subscribe({
      next: (updated) => {
        this.working.set(false);
        this.busyId.set(null);
        this.pending.set(null);
        if (updated.invitation?.status === 'FAILED') {
          // The invitation exists but the email didn't go out: a warning, not an error page.
          this.warning.set(
            `The invitation for ${updated.name} was saved, but the email could not be delivered` +
              (updated.invitation.lastError ? ` (${updated.invitation.lastError})` : '') +
              '. You can resend it.',
          );
        } else {
          this.notice.set(`Invitation sent to ${updated.email}.`);
        }
        this.load();
      },
      error: (e: ApiError) => this.fail(e),
    });
  }

  private doRevoke(g: Guest): void {
    this.clearMessages();
    this.working.set(true);
    this.api.revokeInvitation(this.weddingId(), g.id).subscribe({
      next: () => {
        this.working.set(false);
        this.pending.set(null);
        this.notice.set('Invitation link revoked.');
        this.load();
      },
      error: (e: ApiError) => this.fail(e),
    });
  }

  private doDelete(g: Guest): void {
    this.clearMessages();
    this.working.set(true);
    this.api.remove(this.weddingId(), g.id).subscribe({
      next: () => {
        this.working.set(false);
        this.pending.set(null);
        this.notice.set('Guest deleted.');
        this.load();
      },
      error: (e: ApiError) => this.fail(e),
    });
  }

  private fail(e: ApiError): void {
    this.working.set(false);
    this.busyId.set(null);
    this.pending.set(null);
    this.actionError.set(errorMessage(e));
  }
}
