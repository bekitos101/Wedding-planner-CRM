import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { apiErrorInterceptor } from '../../core/http/api-error.interceptor';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });

  it('shows the server message and per-field errors', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    fixture.componentInstance.form.setValue({ email: 'ann@example.com', password: 'password1' });

    fixture.componentInstance.submit();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/login')
      .flush(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Please check the highlighted fields.',
            fields: { email: 'No account with this email' },
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.alert-danger')?.textContent).toContain(
      'Please check the highlighted fields.',
    );
    expect(el.querySelector('.field-error')?.textContent).toContain('No account with this email');
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
  });

  it('does not call the API when the form is invalid', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    fixture.componentInstance.submit();
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectNone('/api/auth/login');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.field-error').length).toBe(2);
  });
});
