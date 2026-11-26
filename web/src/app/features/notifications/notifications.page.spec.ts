import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { makeNotification } from '../../core/services/notification.testing';
import { NotificationsPage } from './notifications.page';

describe('NotificationsPage', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [NotificationsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const ctrl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NotificationsPage);
    fixture.detectChanges();
    return { ctrl, fixture, el: fixture.nativeElement as HTMLElement };
  }
  const listReq = (ctrl: HttpTestingController) => ctrl.expectOne((r) => r.url === '/api/notifications');

  it('lists all notifications and shows an empty state', () => {
    const { ctrl, fixture, el } = setup();
    const req = listReq(ctrl);
    expect(req.request.params.has('unread')).toBe(false);
    req.flush([]);
    fixture.detectChanges();
    expect(el.textContent).toContain("You're all caught up.");
  });

  it('the Unread toggle requests unread=true', () => {
    const { ctrl, fixture, el } = setup();
    listReq(ctrl).flush([makeNotification()]);
    fixture.detectChanges();
    const buttons = el.querySelectorAll<HTMLButtonElement>('[aria-label="Show notifications"] button');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    buttons[1].click();
    fixture.detectChanges();
    const req = listReq(ctrl);
    expect(req.request.params.get('unread')).toBe('true');
    req.flush([]);
    fixture.detectChanges();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(el.textContent).toContain('no unread notifications');
  });

  it('marks a single item read', () => {
    const { ctrl, fixture, el } = setup();
    listReq(ctrl).flush([makeNotification()]);
    fixture.detectChanges();
    const btn = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes('Mark read'))!;
    btn.click();
    expect(ctrl.expectOne('/api/notifications/n1/read').request.method).toBe('POST');
  });
});
