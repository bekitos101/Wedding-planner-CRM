import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';
import { ApiError } from '../../core/models/api-error';
import { Wedding } from '../../core/models/wedding';
import { WeddingService } from './wedding.service';

export type ContextState = 'idle' | 'loading' | 'ready' | 'notfound' | 'error';

/** Holds the wedding of the current `/weddings/:weddingId` area so child pages share one load. */
@Injectable({ providedIn: 'root' })
export class WeddingContext {
  private readonly api = inject(WeddingService);

  private readonly _wedding = signal<Wedding | null>(null);
  private readonly _state = signal<ContextState>('idle');
  private readonly _error = signal<string | null>(null);
  private currentId: string | null = null;
  private inflight:{ id: string; obs: Observable<Wedding | null> } | null = null;

  readonly wedding = this._wedding.asReadonly();
  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isOwner = computed(() => this._wedding()?.role === 'OWNER');
  readonly isArchived = computed(() => this._wedding()?.status === 'ARCHIVED');
  /** Owner of an active wedding: the only case where write actions are shown. */
  readonly canEdit = computed(() => this.isOwner() && !this.isArchived());

  /** Loads the wedding (once per id; concurrent callers share the request). Never errors. */
  load(id: string, force = false): Observable<Wedding | null> {
    const current = this._wedding();
    if (!force && current?.id === id && this._state() === 'ready') {
      this.currentId = id;
      return of(current);
    }
    if (this.inflight?.id === id) {
      this.currentId = id;
      return this.inflight.obs;
    }

    this.currentId = id;
    if (current?.id !== id) this._wedding.set(null);
    this._state.set('loading');
    this._error.set(null);
    // Responses for an id that is no longer the current one are ignored (quick navigation A -> B).
    const stale = () => this.currentId !== id;
    const obs = this.api.get(id).pipe(
      tap((w) => {
        if (stale()) return;
        this._wedding.set(w);
        this._state.set('ready');
      }),
      map((w): Wedding | null => w),
      catchError((e: ApiError) => {
        if (stale()) return of(null);
        this._wedding.set(null);
        if (e?.error?.code === 'NOT_FOUND') {
          this._state.set('notfound');
        } else {
          this._state.set('error');
          this._error.set(e?.error?.message ?? 'Something went wrong. Please try again.');
        }
        return of(null);
      }),
      finalize(() => {
        if (this.inflight?.id === id) this.inflight = null;
      }),
      shareReplay(1),
    );
    this.inflight = { id, obs };
    return obs;
  }

  /** Replace the cached wedding after an edit or archive. */
  set(w: Wedding): void {
    this._wedding.set(w);
    this._state.set('ready');
  }

  clear(): void {
    this._wedding.set(null);
    this._state.set('idle');
    this._error.set(null);
    this.inflight = null;
    this.currentId = null;
  }
}
