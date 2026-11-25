import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { authGuard, guestGuard, landingGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('guards', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  const run = (guard: typeof authGuard, url = '/profile') =>
    TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  function logIn(): void {
    TestBed.inject(AuthService).loadMe().subscribe();
    TestBed.inject(HttpTestingController).expectOne('/api/me').flush({
      id: 'u1',
      name: 'Ann',
      email: 'ann@example.com',
      createdAt: '2026-01-01T00:00:00Z',
    });
  }

  it('authGuard redirects anonymous users to /login with returnUrl', () => {
    const result = run(authGuard) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/login?returnUrl=%2Fprofile');
  });

  it('authGuard allows logged-in users', () => {
    logIn();
    expect(run(authGuard)).toBe(true);
  });

  it('guestGuard redirects logged-in users to /weddings', () => {
    logIn();
    const result = run(guestGuard) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/weddings');
  });

  it('landingGuard redirects logged-in users to /weddings', () => {
    logIn();
    const result = run(landingGuard) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/weddings');
  });

  it('landingGuard shows the landing page to anonymous visitors', () => {
    expect(run(landingGuard)).toBe(true);
  });

  it('guestGuard allows anonymous users', () => {
    expect(run(guestGuard)).toBe(true);
  });
});
