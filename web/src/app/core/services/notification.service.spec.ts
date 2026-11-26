import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { makeNotification } from './notification.testing';
import { NOTIFICATION_POLL_MS, NotificationService } from './notification.service';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const ctrl = TestBed.inject(HttpTestingController);
  const auth = TestBed.inject(AuthService);
  const store = TestBed.inject(NotificationService);
  return { ctrl, auth, store };
}

function login(ctrl: HttpTestingController, auth: AuthService) {
  auth.loadMe().subscribe();
  ctrl.expectOne('/api/me').flush({ id: 'u1', name: 'Ann', email: 'a@b.c', createdAt: '2026-01-01T00:00:00Z' });
}

const COUNT = '/api/notifications/unread-count';

describe('NotificationService', () => {
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
  });

  it('does not poll while logged out', () => {
    vi.useFakeTimers();
    const { ctrl } = setup();
    TestBed.tick();
    vi.advanceTimersByTime(NOTIFICATION_POLL_MS * 2);
    ctrl.expectNone(COUNT);
  });

  it('polls every 60 s while logged in and visible', () => {
    vi.useFakeTimers();
    const { ctrl, auth, store } = setup();
    login(ctrl, auth);
    TestBed.tick();
    vi.advanceTimersByTime(1);
    ctrl.expectOne(COUNT).flush({ count: 4 });
    expect(store.unreadCount()).toBe(4);
    vi.advanceTimersByTime(NOTIFICATION_POLL_MS);
    ctrl.expectOne(COUNT).flush({ count: 5 });
    expect(store.unreadCount()).toBe(5);
  });

  it('pauses while the tab is hidden and refreshes when it is visible again', () => {
    vi.useFakeTimers();
    const { ctrl, auth } = setup();
    login(ctrl, auth);
    TestBed.tick();
    vi.advanceTimersByTime(1);
    ctrl.expectOne(COUNT).flush({ count: 1 });
    setHidden(true);
    TestBed.tick();
    vi.advanceTimersByTime(NOTIFICATION_POLL_MS * 3);
    ctrl.expectNone(COUNT);
    setHidden(false);
    TestBed.tick();
    vi.advanceTimersByTime(1);
    ctrl.expectOne(COUNT).flush({ count: 2 });
  });

  it('stops polling and clears state after logout', () => {
    vi.useFakeTimers();
    const { ctrl, auth, store } = setup();
    login(ctrl, auth);
    TestBed.tick();
    vi.advanceTimersByTime(1);
    ctrl.expectOne(COUNT).flush({ count: 3 });
    auth.clearSession();
    TestBed.tick();
    vi.advanceTimersByTime(NOTIFICATION_POLL_MS * 3);
    ctrl.expectNone(COUNT);
    expect(store.unreadCount()).toBe(0);
  });

  it('loadList passes unread=true only for the unread view', () => {
    const { ctrl, store } = setup();
    store.loadList(true);
    const req = ctrl.expectOne((r) => r.url === '/api/notifications');
    expect(req.request.params.get('unread')).toBe('true');
    req.flush([makeNotification()]);
    expect(store.items().length).toBe(1);
    store.loadList(false);
    const all = ctrl.expectOne((r) => r.url === '/api/notifications');
    expect(all.request.params.has('unread')).toBe(false);
    all.flush([]);
  });

  it('markRead updates optimistically and rolls back on error', () => {
    const { ctrl, store } = setup();
    store.loadList(false);
    ctrl.expectOne((r) => r.url === '/api/notifications').flush([makeNotification()]);
    store['_unreadCount'].set(2);
    let result: boolean | undefined;
    store.markRead('n1').subscribe((ok) => (result = ok));
    expect(store.unreadCount()).toBe(1);
    expect(store.items()[0].readAt).not.toBeNull();
    ctrl.expectOne('/api/notifications/n1/read').flush(
      { error: { code: 'INTERNAL', message: 'Boom' } },
      { status: 500, statusText: 'Server Error' },
    );
    expect(result).toBe(false);
    expect(store.unreadCount()).toBe(2);
    expect(store.items()[0].readAt).toBeNull();
    expect(store.actionError()).toBeTruthy();
  });

  it('markAllRead zeroes the count and rolls back on error', () => {
    const { ctrl, store } = setup();
    store.loadList(false);
    ctrl.expectOne((r) => r.url === '/api/notifications').flush([makeNotification()]);
    store['_unreadCount'].set(3);
    store.markAllRead().subscribe();
    expect(store.unreadCount()).toBe(0);
    ctrl.expectOne('/api/notifications/read-all').flush(null, { status: 204, statusText: 'No Content' });
    expect(store.unreadCount()).toBe(0);

    store['_unreadCount'].set(3);
    store['_items'].set([makeNotification()]);
    store.markAllRead().subscribe();
    ctrl.expectOne('/api/notifications/read-all').flush({}, { status: 500, statusText: 'Server Error' });
    expect(store.unreadCount()).toBe(3);
    expect(store.items()[0].readAt).toBeNull();
  });

  it('ignores a list response that was in flight at logout', () => {
    const { ctrl, auth, store } = setup();
    login(ctrl, auth);
    TestBed.tick();
    store.loadList(false);
    const req = ctrl.expectOne((r) => r.url === '/api/notifications');
    auth.clearSession();
    TestBed.tick();
    req.flush([makeNotification()]);
    expect(store.items()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('ignores a count poll requested before markAllRead', () => {
    vi.useFakeTimers();
    const { ctrl, auth, store } = setup();
    login(ctrl, auth);
    TestBed.tick();
    vi.advanceTimersByTime(1);
    ctrl.expectOne(COUNT).flush({ count: 3 });
    vi.advanceTimersByTime(NOTIFICATION_POLL_MS);
    const stalePoll = ctrl.expectOne(COUNT);
    store.markAllRead().subscribe();
    expect(store.unreadCount()).toBe(0);
    stalePoll.flush({ count: 3 });
    expect(store.unreadCount()).toBe(0);
    ctrl.expectOne('/api/notifications/read-all').flush(null, { status: 204, statusText: 'No Content' });
    ctrl.expectOne(COUNT).flush({ count: 0 });
    expect(store.unreadCount()).toBe(0);
  });

  it('refetches the count after markRead even if the item is not in the list', () => {
    const { ctrl, store } = setup();
    store['_unreadCount'].set(2);
    store.markRead('zzz').subscribe();
    ctrl.expectOne('/api/notifications/zzz/read').flush(makeNotification({ id: 'zzz', readAt: new Date().toISOString() }));
    ctrl.expectOne(COUNT).flush({ count: 1 });
    expect(store.unreadCount()).toBe(1);
  });
});
