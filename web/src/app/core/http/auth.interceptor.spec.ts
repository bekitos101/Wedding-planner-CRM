import { HttpClient } from '@angular/common/http';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { apiErrorInterceptor } from './api-error.interceptor';
import { authInterceptor } from './auth.interceptor';

const unauth = { error: { code: 'UNAUTHENTICATED', message: 'Please log in.' } };
const status401 = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let router: Router;
  let auth: AuthService;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiErrorInterceptor, authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    // start logged in
    auth.login({ email: 'a@b.co', password: 'password1' }).subscribe();
    ctrl.expectOne('/api/auth/login').flush({ id: '1', name: 'A', email: 'a@b.co', createdAt: '' });
  });

  function setUrl(url: string): void {
    vi.spyOn(router, 'url', 'get').mockReturnValue(url);
  }

  it('401 on another call clears the session, redirects and still propagates ApiError', () => {
    setUrl('/profile');
    let caught: unknown;
    http.get('/api/weddings').subscribe({ error: (e) => (caught = e) });
    ctrl.expectOne('/api/weddings').flush(unauth, status401);

    expect(auth.isLoggedIn()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/profile' } });
    expect((caught as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('401 on GET /api/me does not redirect', () => {
    setUrl('/profile');
    http.get('/api/me').subscribe({ error: () => undefined });
    ctrl.expectOne('/api/me').flush(unauth, status401);
    expect(navigate).not.toHaveBeenCalled();
    expect(auth.isLoggedIn()).toBe(true);
  });

  it('401 on POST /api/auth/login does not redirect', () => {
    setUrl('/login');
    http.post('/api/auth/login', {}).subscribe({ error: () => undefined });
    ctrl.expectOne('/api/auth/login').flush(unauth, status401);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not redirect (no loop) when already on /login', () => {
    setUrl('/login?returnUrl=%2Fprofile');
    http.get('/api/weddings').subscribe({ error: () => undefined });
    ctrl.expectOne('/api/weddings').flush(unauth, status401);
    expect(navigate).not.toHaveBeenCalled();
    expect(auth.isLoggedIn()).toBe(false);
  });
});
