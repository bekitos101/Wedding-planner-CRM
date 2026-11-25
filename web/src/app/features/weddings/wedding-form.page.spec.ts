import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WeddingFormPage } from './wedding-form.page';
import { httpTestProviders } from './testing';

describe('WeddingFormPage', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [WeddingFormPage],
      providers: [provideRouter([]), ...httpTestProviders()],
    });
    const fixture = TestBed.createComponent(WeddingFormPage);
    fixture.detectChanges();
    return { fixture, ctrl: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
  }

  const valid = {
    coupleNames: 'Anna & Ben',
    weddingDate: '2027-06-12',
    location: 'Budapest',
    totalBudget: '25000',
    rsvpDeadline: '2027-05-01',
  };

  it('shows the server fields.rsvpDeadline error next to the input', () => {
    const { fixture, ctrl, el } = setup();
    fixture.componentInstance.form.setValue(valid);
    fixture.componentInstance.submit();
    ctrl.expectOne('/api/weddings').flush(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          fields: { rsvpDeadline: 'Must be on or before the wedding date' },
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    const field = el.querySelector('#rsvpDeadline')!.closest('.field')!;
    expect(field.querySelector('.field-error')?.textContent).toContain('Must be on or before the wedding date');
    expect(el.querySelector('.alert-danger')?.textContent).toContain('Please check the highlighted fields.');
  });

  it('blocks a deadline after the wedding date and a budget with 3 decimals on the client', () => {
    const { fixture, ctrl, el } = setup();
    fixture.componentInstance.form.setValue({
      ...valid,
      rsvpDeadline: '2027-07-01',
      totalBudget: '10.123',
    });
    fixture.componentInstance.submit();
    ctrl.expectNone('/api/weddings');
    fixture.detectChanges();
    expect(el.textContent).toContain('on or before the wedding date');
    expect(el.textContent).toContain('at most 2 decimals');
  });

  it('rejects dates outside 2000-01-01..2100-12-31 and budgets over 10 integer digits', () => {
    const { fixture, ctrl, el } = setup();
    fixture.componentInstance.form.setValue({
      ...valid,
      weddingDate: '2101-01-01',
      rsvpDeadline: '1999-12-31',
      totalBudget: '12345678901',
    });
    fixture.componentInstance.submit();
    ctrl.expectNone('/api/weddings');
    fixture.detectChanges();
    expect(el.textContent).toContain('between 2000-01-01 and 2100-12-31');
    expect(el.textContent).toContain('up to 10 digits');
  });

  it('posts the wedding when valid', () => {
    const { fixture, ctrl } = setup();
    fixture.componentInstance.form.setValue(valid);
    fixture.componentInstance.submit();
    const req = ctrl.expectOne('/api/weddings');
    expect(req.request.body.totalBudget).toBe('25000');
    expect(req.request.body.rsvpDeadline).toBe('2027-05-01');
  });
});
