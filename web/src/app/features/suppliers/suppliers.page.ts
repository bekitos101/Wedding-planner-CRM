import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { errorMessage } from '../../core/forms/server-errors';
import { ApiError } from '../../core/models/api-error';
import { Supplier } from '../../core/models/supplier';
import { MoneyPipe } from '../../core/pipes/money.pipe';
import { ArchivedNoteComponent } from '../../core/ui/archived-note.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog.component';
import { WeddingContext } from '../weddings/wedding-context.service';
import { SupplierFormComponent } from './supplier-form.component';
import { SupplierService } from './supplier.service';

@Component({
  selector: 'app-suppliers-page',
  imports: [FormsModule, ReactiveFormsModule, MoneyPipe, ArchivedNoteComponent, ConfirmDialogComponent, SupplierFormComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="mb-0 mr-auto">Suppliers</h1>
      @if (ctx.canEdit()) {
        <button type="button" class="btn btn-primary btn-sm" (click)="creating.set(true); editing.set(null)">Add supplier</button>
      }
    </div>
    @if (ctx.isArchived()) { <app-archived-note /> }
    @if (notice(); as msg) { <p class="alert alert-success" role="status">{{ msg }}</p> }
    @if (actionError(); as msg) { <p class="alert alert-danger" role="alert">{{ msg }}</p> }

    @if (creating() && ctx.canEdit()) {
      <app-supplier-form [weddingId]="weddingId()" (saved)="onSaved('Supplier added.')" (cancelled)="creating.set(false)" />
    }
    @if (editing(); as s) {
      <app-supplier-form [weddingId]="weddingId()" [supplier]="s" (saved)="onSaved('Supplier saved.')" (cancelled)="editing.set(null)" />
    }

    <section class="card mb-4 flex flex-col gap-3 sm:flex-row sm:items-end" aria-label="Filters">
      <div class="flex-1">
        <label class="label" for="supSearch">Search</label>
        <input class="input" id="supSearch" type="search" placeholder="Name, category or contact" [formControl]="search" />
      </div>
      <div>
        <label class="label" for="supFilter">Category</label>
        <select class="input" id="supFilter" [ngModel]="category()" (ngModelChange)="category.set($event); load()">
          <option value="">All categories</option>
          @for (c of knownCategories(); track c) { <option [value]="c">{{ c }}</option> }
        </select>
      </div>
    </section>

    @if (loading()) {
      <p class="text-muted">Loading suppliers...</p>
    } @else if (loadError(); as msg) {
      <p class="alert alert-danger" role="alert">{{ msg }}</p>
      <button type="button" class="btn btn-secondary" (click)="load()">Try again</button>
    } @else if (suppliers().length === 0) {
      <section class="card text-center">
        <p class="py-6 text-muted">{{ filtered() ? 'No suppliers match your search.' : 'No suppliers yet.' }}</p>
        @if (ctx.canEdit() && !filtered()) { <button type="button" class="btn btn-primary" (click)="creating.set(true)">Add the first supplier</button> }
      </section>
    } @else {
      <ul class="grid gap-3 md:grid-cols-2">
        @for (s of suppliers(); track s.id) {
          <li class="card !p-4 flex flex-col gap-2" data-testid="supplier-card">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="mr-auto">{{ s.name }}</strong>
              <span class="chip chip-owner">{{ s.category }}</span>
            </div>
            <div class="text-sm">{{ s.contactInfo || 'No contact info' }}</div>
            <div class="text-sm"><span class="text-muted">Quoted price:</span> <span data-testid="quoted">{{ s.quotedPrice ? (s.quotedPrice | money) : '—' }}</span></div>
            @if (s.notes) { <div class="text-sm text-muted">{{ s.notes }}</div> }
            @if (ctx.canEdit()) {
              <div class="flex gap-2">
                <button type="button" class="btn btn-secondary btn-sm" (click)="editing.set(s); creating.set(false)">Edit</button>
                <button type="button" class="btn btn-secondary btn-sm" (click)="toDelete.set(s)">Delete</button>
              </div>
            }
          </li>
        }
      </ul>
    }

    @if (toDelete(); as s) {
      <app-confirm-dialog title="Delete this supplier?" [message]="'“' + s.name + '” will be removed.'"
        confirmLabel="Delete supplier" [busy]="deleting()" (confirmed)="remove(s)" (cancelled)="toDelete.set(null)" />
    }
  `,
})
export class SuppliersPage {
  protected readonly ctx = inject(WeddingContext);
  private readonly api = inject(SupplierService);

  readonly weddingId = computed(() => this.ctx.wedding()!.id);
  readonly suppliers = signal<Supplier[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly search = new FormControl('', { nonNullable: true });
  private readonly searchText = signal('');
  readonly category = signal('');
  readonly filtered = computed(() => !!this.searchText() || !!this.category());
  /** Categories seen so far, so the filter keeps its options while a filter is active. */
  private readonly seen = signal<string[]>([]);
  readonly knownCategories = computed(() => [...this.seen()].sort());

  readonly creating = signal(false);
  readonly editing = signal<Supplier | null>(null);
  readonly toDelete = signal<Supplier | null>(null);
  readonly deleting = signal(false);

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

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    const seq = ++this.loadSeq;
    this.api.list(this.weddingId(), this.searchText(), this.category()).subscribe({
      next: (list) => {
        if (seq !== this.loadSeq) return; // a newer request superseded this one
        this.suppliers.set(list);
        this.seen.update((cur) => [...new Set([...cur, ...list.map((s) => s.category)])]);
        this.loading.set(false);
      },
      error: (e: ApiError) => {
        if (seq !== this.loadSeq) return;
        this.loadError.set(errorMessage(e));
        this.loading.set(false);
      },
    });
  }

  onSaved(msg: string): void {
    this.creating.set(false);
    this.editing.set(null);
    this.notice.set(msg);
    this.load();
  }

  remove(s: Supplier): void {
    this.deleting.set(true);
    this.api.remove(this.weddingId(), s.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.toDelete.set(null);
        this.notice.set('Supplier deleted.');
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
