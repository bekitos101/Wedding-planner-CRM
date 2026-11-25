import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { User } from '../models/user';
import { AuthService } from './auth.service';

const user: User = { id: 'u1', name: 'Ann', email: 'ann@example.com', createdAt: '2026-01-01T00:00:00Z' };

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('login sets currentUser', () => {
    service.login({ email: user.email, password: 'password1' }).subscribe();
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    req.flush(user);
    expect(service.currentUser()).toEqual(user);
    expect(service.isLoggedIn()).toBe(true);
  });

  it('loadMe with 401 yields null', () => {
    let result: User | null | undefined;
    service.loadMe().subscribe((u) => (result = u));
    http.expectOne('/api/me').flush(
      { error: { code: 'UNAUTHENTICATED', message: 'Please log in.' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    expect(result).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
  });

  it('logout clears currentUser', () => {
    service.login({ email: user.email, password: 'password1' }).subscribe();
    http.expectOne('/api/auth/login').flush(user);
    service.logout().subscribe();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(service.currentUser()).toBeNull();
  });
});
