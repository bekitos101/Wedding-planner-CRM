import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../services/notification.service';
import { makeNotification } from '../services/notification.testing';
import { SiteHeaderComponent } from './site-header.component';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const ctrl = TestBed.inject(HttpTestingController);
  TestBed.inject(AuthService).loadMe().subscribe();
  ctrl.expectOne('/api/me').flush({ id: 'u1', name: 'Ann', email: 'a@b.c', createdAt: '2026-01-01T00:00:00Z' });
  const store = TestBed.inject(NotificationService);
  const fixture = TestBed.createComponent(SiteHeaderComponent);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const bell = () => el.querySelector<HTMLButtonElement>('button[aria-controls=notif-panel]')!;
  const panel = () => el.querySelector<HTMLElement>('#notif-panel')!;
  const badge = () => el.querySelector<HTMLElement>('[data-testid=notif-badge]');
  const setCount = (n: number) => {
    store['_unreadCount'].set(n);
    fixture.detectChanges();
  };
  return { ctrl, store, fixture, el, bell, panel, badge, setCount };
}

describe('Notification bell', () => {
  it('hides the badge at 0, shows the count, and "9+" above 9', () => {
    const { badge, setCount, bell } = setup();
    setCount(0);
    expect(badge()).toBeNull();
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
    setCount(3);
    expect(badge()!.textContent!.trim()).toBe('3');
    expect(bell().getAttribute('aria-label')).toContain('3 unread');
    setCount(10);
    expect(badge()!.textContent!.trim()).toBe('9+');
    expect(bell().getAttribute('aria-label')).toContain('10 unread');
  });

  it('opens the panel and loads the list', () => {
    const { ctrl, fixture, bell, panel } = setup();
    expect(panel().hidden).toBe(true);
    bell().click();
    fixture.detectChanges();
    expect(panel().hidden).toBe(false);
    expect(bell().getAttribute('aria-expanded')).toBe('true');
    const req = ctrl.expectOne((r) => r.url === '/api/notifications');
    expect(req.request.params.has('unread')).toBe(false);
    req.flush([makeNotification()]);
    fixture.detectChanges();
    expect(panel().textContent).toContain('Task due in 3 days');
    expect(panel().textContent).toContain('Emma & Daniel');
  });

  it('shows the empty state and an error with retry', () => {
    const { ctrl, fixture, bell, panel } = setup();
    bell().click();
    fixture.detectChanges();
    ctrl.expectOne((r) => r.url === '/api/notifications').flush([]);
    fixture.detectChanges();
    expect(panel().textContent).toContain("You're all caught up.");
    TestBed.inject(NotificationService).loadList(false);
    ctrl.expectOne((r) => r.url === '/api/notifications').flush({ error: { code: 'X', message: 'Nope' } }, { status: 500, statusText: 'x' });
    fixture.detectChanges();
    expect(panel().textContent).toContain('Try again');
  });

  it('clicking an item marks it read, then navigates to its link', () => {
    const { ctrl, fixture, bell, panel } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    bell().click();
    fixture.detectChanges();
    ctrl.expectOne((r) => r.url === '/api/notifications').flush([makeNotification()]);
    fixture.detectChanges();
    panel().querySelector<HTMLButtonElement>('app-notification-item button')!.click();
    expect(navigate).not.toHaveBeenCalled();
    const req = ctrl.expectOne('/api/notifications/n1/read');
    expect(req.request.method).toBe('POST');
    req.flush(makeNotification({ readAt: new Date().toISOString() }));
    expect(navigate).toHaveBeenCalledWith('/weddings/w1/tasks');
  });

  it('mark all as read is disabled at 0 and zeroes the badge otherwise', () => {
    const { ctrl, fixture, bell, panel, badge, setCount } = setup();
    setCount(0);
    const markAll = () => panel().querySelector<HTMLButtonElement>('.border-b button')!;
    expect(markAll().disabled).toBe(true);
    setCount(2);
    expect(markAll().disabled).toBe(false);
    markAll().click();
    fixture.detectChanges();
    expect(badge()).toBeNull();
    ctrl.expectOne('/api/notifications/read-all').flush(null, { status: 204, statusText: 'No Content' });
    void bell;
  });

  it('closes on Esc with focus back on the bell, and when the user menu opens', () => {
    const { fixture, el, bell, panel } = setup();
    bell().click();
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).match((r) => r.url === '/api/notifications');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(bell());

    bell().click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('button[aria-controls=user-menu]')!.click();
    fixture.detectChanges();
    expect(panel().hidden).toBe(true);
    expect(el.querySelector<HTMLElement>('#user-menu')!.hidden).toBe(false);
  });

  it('closes on an outside click', () => {
    const { fixture, bell, panel } = setup();
    bell().click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(panel().hidden).toBe(true);
  });
});
