import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';

describe('routing of /', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('shows the landing page to a logged-out visitor', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/');
    expect(harness.routeNativeElement?.querySelector('app-landing-page')).not.toBeNull();
  });

  it('sends a logged-in planner to /weddings', async () => {
    TestBed.inject(AuthService).loadMe().subscribe();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/me')
      .flush({ id: 'u1', name: 'Ann', email: 'ann@example.com', createdAt: '2026-01-01T00:00:00Z' });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/weddings');
    expect(harness.routeNativeElement?.querySelector('app-landing-page')).toBeNull();
  });
});
