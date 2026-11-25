import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { SiteFooterComponent } from './site-footer.component';
import { SiteHeaderComponent } from './site-header.component';

function setup(loggedIn: boolean) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  if (loggedIn) {
    TestBed.inject(AuthService).loadMe().subscribe();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/me')
      .flush({ id: 'u1', name: 'Ann Planner', email: 'ann@example.com', createdAt: '2026-01-01T00:00:00Z' });
  }
}

describe('SiteHeaderComponent', () => {
  it('shows Log in and Get started when logged out', () => {
    setup(false);
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Log in');
    expect(text).toContain('Get started');
    expect(text).not.toContain('My weddings');
    expect(text).toContain('Features');
    expect(text).toContain('How it works');
  });

  it('hides Features and How it works when logged in, but keeps Contact', () => {
    setup(true);
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Features');
    expect(text).not.toContain('How it works');
    expect(text).toContain('Contact');
  });

  it('shows My weddings and a Log out action when logged in', () => {
    setup(true);
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('My weddings');
    expect(el.textContent).toContain('Ann Planner');
    expect(el.textContent).not.toContain('Get started');
    const menu = el.querySelector<HTMLElement>('#user-menu')!;
    const button = el.querySelector<HTMLButtonElement>('button[aria-controls=user-menu]')!;
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    fixture.detectChanges();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(menu.textContent).toContain('Log out');
    expect(menu.textContent).toContain('Profile');
    expect(el.querySelector('[role=menu], [aria-haspopup]')).toBeNull();
  });

  it('closes the user menu on Esc and returns focus to its button', () => {
    setup(true);
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector<HTMLButtonElement>('button[aria-controls=user-menu]')!;
    button.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector<HTMLElement>('#user-menu')!.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    fixture.nativeElement.remove();
  });

  it('closes the user menu on an outside click', () => {
    setup(true);
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('button[aria-controls=user-menu]')!.click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(el.querySelector<HTMLElement>('#user-menu')!.hidden).toBe(true);
    fixture.nativeElement.remove();
  });

  it('toggles the mobile menu', () => {
    setup(false);
    const fixture = TestBed.createComponent(SiteHeaderComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector<HTMLElement>('#mobile-menu')!;
    expect(panel.hidden).toBe(true);
    el.querySelector<HTMLButtonElement>('button[aria-controls=mobile-menu]')!.click();
    fixture.detectChanges();
    expect(panel.hidden).toBe(false);
  });
});

describe('SiteFooterComponent', () => {
  it('renders the copyright line with the current year', () => {
    setup(false);
    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    const normalised = text.replace(/\s+/g, ' ');
    expect(text).toContain('Features');
    expect(normalised).toContain(`© ${new Date().getFullYear()} Wedding Organizer. All rights reserved.`);
  });
});

describe('SiteFooterComponent when logged in', () => {
  it('hides the Features and How it works links', () => {
    setup(true);
    const fixture = TestBed.createComponent(SiteFooterComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Features');
    expect(text).not.toContain('How it works');
    expect(text).toContain('Contact');
  });
});
