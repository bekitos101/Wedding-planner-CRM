import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { apiErrorInterceptor } from '../../core/http/api-error.interceptor';
import { ContactPage } from './contact.page';

describe('ContactPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([apiErrorInterceptor])), provideHttpClientTesting()],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(ContactPage);
    fixture.detectChanges();
    return fixture;
  }

  function submitValid(fixture: ReturnType<typeof create>) {
    fixture.componentInstance.form.patchValue({
      name: 'Ann',
      email: 'ann@example.com',
      message: 'Hello, I have a question.',
    });
    fixture.componentInstance.submit();
  }

  it('has a hidden honeypot field named contact_hp', () => {
    const fixture = create();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[name=contact_hp]')!;
    expect(input).toBeTruthy();
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.closest('[aria-hidden=true]')).toBeTruthy();
  });

  it('does not call the API and shows field errors when invalid', () => {
    const fixture = create();
    fixture.componentInstance.submit();
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectNone('/api/contact');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.field-error').length).toBe(3);
  });

  it('shows server field errors next to the inputs', () => {
    const fixture = create();
    submitValid(fixture);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/contact')
      .flush(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Please check the highlighted fields.',
            fields: { email: 'Enter a valid email' },
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const field = el.querySelector('#contactEmail')!.closest('.field')!;
    expect(field.querySelector('.field-error')?.textContent).toContain('Enter a valid email');
    expect(el.querySelector('.alert-danger')?.textContent).toContain('Please check the highlighted fields.');
  });

  it('shows the 429 message in an alert', () => {
    const fixture = create();
    submitValid(fixture);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/contact')
      .flush(
        { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many messages. Please try again later.' } },
        { status: 429, statusText: 'Too Many Requests' },
      );
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.alert-danger')?.textContent).toContain(
      'Too many messages.',
    );
  });

  it('shows the 503 message in an alert', () => {
    const fixture = create();
    submitValid(fixture);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/contact')
      .flush(
        { error: { code: 'SERVICE_UNAVAILABLE', message: "We couldn't send your message right now. Please try again later." } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.alert-danger')?.textContent).toContain("couldn't send your message");
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
  });

  it('disables the submit button while the request is pending', () => {
    const fixture = create();
    submitValid(fixture);
    fixture.detectChanges();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(button.disabled).toBe(true);
    TestBed.inject(HttpTestingController).expectOne('/api/contact').flush({ message: 'ok' }, { status: 202, statusText: 'Accepted' });
  });

  it('links field errors to their inputs for assistive technology', () => {
    const fixture = create();
    fixture.componentInstance.submit();
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('#contactName')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const id = input.getAttribute('aria-describedby')!;
    expect(fixture.nativeElement.querySelector('#' + id)?.classList.contains('field-error')).toBe(true);
  });

  it('replaces the form with the server message on success and can send another', () => {
    const fixture = create();
    submitValid(fixture);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/contact')
      .flush({ message: 'Thanks! We will get back to you soon.' }, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Thanks! We will get back to you soon.');
    expect(el.querySelector('form')).toBeNull();
    el.querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    expect(el.querySelector('form')).not.toBeNull();
  });
});
