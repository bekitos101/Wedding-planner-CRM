import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { apiErrorInterceptor } from '../../core/http/api-error.interceptor';
import { ProfilePage } from './profile.page';

const forbidden = {
  error: {
    code: 'FORBIDDEN',
    message: 'Current password is incorrect.',
    fields: { currentPassword: 'Current password is incorrect.' },
  },
};

describe('ProfilePage', () => {
  let ctrl: HttpTestingController;

  function setup() {
    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    ctrl = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);
    auth.loadMe().subscribe();
    ctrl.expectOne('/api/me').flush({ id: '1', name: 'Ann', email: 'ann@example.com', createdAt: '' });
    const fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    return { fixture, auth };
  }

  it('shows a wrong currentPassword under the password-section input', () => {
    const { fixture } = setup();
    fixture.componentInstance.pw.setValue({ password: 'newpassword1', currentPassword: 'wrong-one' });
    fixture.componentInstance.savePassword();
    ctrl.expectOne('/api/me').flush(forbidden, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const field = el.querySelector('#pwCurrent')!.closest('.field')!;
    expect(field.querySelector('.field-error')?.textContent).toContain('Current password is incorrect.');
  });

  it('shows a wrong currentPassword under the details-section input when email changes', () => {
    const { fixture } = setup();
    fixture.componentInstance.details.patchValue({ email: 'new@example.com', currentPassword: 'wrong-one' });
    fixture.detectChanges();
    fixture.componentInstance.saveDetails();
    ctrl.expectOne('/api/me').flush(forbidden, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const field = el.querySelector('#detailsCurrent')!.closest('.field')!;
    expect(field.querySelector('.field-error')?.textContent).toContain('Current password is incorrect.');
  });

  it('keeps the user logged in after a successful password change', () => {
    const { fixture, auth } = setup();
    fixture.componentInstance.pw.setValue({ password: 'newpassword1', currentPassword: 'password1' });
    fixture.componentInstance.savePassword();
    ctrl.expectOne('/api/me').flush({ id: '1', name: 'Ann', email: 'ann@example.com', createdAt: '' });
    fixture.detectChanges();
    expect(auth.isLoggedIn()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('.alert-success')).toBeTruthy();
  });

  it('rejects passwords longer than 72 characters', () => {
    const { fixture } = setup();
    fixture.componentInstance.pw.setValue({ password: 'x'.repeat(73), currentPassword: 'a' });
    fixture.componentInstance.savePassword();
    ctrl.expectNone('/api/me');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('at most 72');
  });
});
