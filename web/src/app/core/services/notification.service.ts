import { HttpClient, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AsyncSubject, Observable, defer, Subject, catchError, filter, map, merge, of, switchMap, timer } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { errorMessage } from '../forms/server-errors';
import { AppNotification } from '../models/notification';

export const NOTIFICATION_POLL_MS = 60_000;

/**
 * Signal store for in-app notifications (FR-61). Root-provided so polling survives the header
 * being recreated between layouts. Polls the unread count only while logged in and the tab is
 * visible; also refreshes on window focus and after each navigation.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly _unreadCount = signal(0);
  private readonly _items = signal<AppNotification[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _actionError = signal<string | null>(null);
  private readonly visible = signal(typeof document === 'undefined' || document.visibilityState !== 'hidden');
  private readonly refresh$ = new Subject<void>();
  private listSeq = 0;
  /** Bumped on every local count mutation; older in-flight count responses are ignored. */
  private mutSeq = 0;

  readonly unreadCount = this._unreadCount.asReadonly();
  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /** Set when marking read failed (and was rolled back). */
  readonly actionError = this._actionError.asReadonly();
  readonly polling = computed(() => this.auth.isLoggedIn() && this.visible());

  constructor() {
    const onVisibility = () => this.visible.set(document.visibilityState !== 'hidden');
    const onFocus = () => this.refresh$.next();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    });

    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.refresh$.next());

    // Start/stop polling from auth + visibility state; cleanup tears the subscription down.
    effect((onCleanup) => {
      if (!this.polling()) return;
      const sub = merge(timer(0, NOTIFICATION_POLL_MS), this.refresh$)
        .pipe(switchMap(() => this.fetchCount()))
        .subscribe((r) => this.applyCount(r));
      onCleanup(() => sub.unsubscribe());
    });

    // Forget everything on logout so the next user never sees stale data.
    let wasLoggedIn = false;
    effect(() => {
      const loggedIn = this.auth.isLoggedIn();
      const loggedOut = wasLoggedIn && !loggedIn;
      wasLoggedIn = loggedIn;
      if (loggedOut) {
        this.listSeq++;
        this.mutSeq++;
        this._loading.set(false);
        this._unreadCount.set(0);
        this._items.set([]);
        this._error.set(null);
        this._actionError.set(null);
      }
    });
  }

  private fetchCount(): Observable<{ count: number; seq: number } | null> {
    return defer(() => {
      const seq = this.mutSeq;
      return this.http.get<{ count: number }>('/api/notifications/unread-count').pipe(
        map((r) => ({ count: r.count, seq })),
        catchError(() => of(null)),
      );
    });
  }

  private applyCount(r: { count: number; seq: number } | null): void {
    if (r && r.seq === this.mutSeq) this._unreadCount.set(r.count);
  }

  loadUnreadCount(): void {
    this.fetchCount().subscribe((r) => this.applyCount(r));
  }

  loadList(unreadOnly: boolean): void {
    const seq = ++this.listSeq;
    this._loading.set(true);
    this._error.set(null);
    let params = new HttpParams();
    if (unreadOnly) params = params.set('unread', 'true');
    this.http.get<AppNotification[]>('/api/notifications', { params }).subscribe({
      next: (list) => {
        if (seq !== this.listSeq) return;
        this._items.set(list);
        this._loading.set(false);
      },
      error: (e) => {
        if (seq !== this.listSeq) return;
        this._error.set(errorMessage(e));
        this._loading.set(false);
      },
    });
  }

  /** Optimistic; emits true on success, false after a rollback. Already subscribed. */
  markRead(id: string): Observable<boolean> {
    const done = new AsyncSubject<boolean>();
    const target = this._items().find((n) => n.id === id);
    const wasUnread = !!target && target.readAt === null;
    const prevItems = this._items();
    const prevCount = this._unreadCount();
    this._actionError.set(null);
    this.mutSeq++;
    if (wasUnread) {
      const readAt = new Date().toISOString();
      this._items.update((l) => l.map((n) => (n.id === id ? { ...n, readAt } : n)));
      this._unreadCount.update((c) => Math.max(0, c - 1));
    }
    this.http.post<AppNotification>(`/api/notifications/${id}/read`, {}).subscribe({
      next: (updated) => {
        this._items.update((l) => l.map((n) => (n.id === id ? updated : n)));
        this.loadUnreadCount();
        done.next(true);
        done.complete();
      },
      error: (e) => {
        if (wasUnread) {
          this._items.set(prevItems);
          this._unreadCount.set(prevCount);
        }
        this._actionError.set(errorMessage(e));
        done.next(false);
        done.complete();
      },
    });
    return done.asObservable();
  }

  markAllRead(): Observable<boolean> {
    const done = new AsyncSubject<boolean>();
    const prevItems = this._items();
    const prevCount = this._unreadCount();
    const readAt = new Date().toISOString();
    this._actionError.set(null);
    this.mutSeq++;
    this._items.update((l) => l.map((n) => (n.readAt ? n : { ...n, readAt })));
    this._unreadCount.set(0);
    this.http.post<void>('/api/notifications/read-all', {}).subscribe({
      next: () => {
        this.loadUnreadCount();
        done.next(true);
        done.complete();
      },
      error: (e) => {
        this._items.set(prevItems);
        this._unreadCount.set(prevCount);
        this._actionError.set(errorMessage(e));
        done.next(false);
        done.complete();
      },
    });
    return done.asObservable();
  }
}
