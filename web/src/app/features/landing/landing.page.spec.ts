import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LandingPage } from './landing.page';

describe('LandingPage', () => {
  function render() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(LandingPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('links the calls to action to /register and /login', () => {
    const el = render();
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/register');
    expect(hrefs).toContain('/login');
  });

  it('has the features and how-it-works sections', () => {
    const el = render();
    expect(el.querySelector('#features')).not.toBeNull();
    expect(el.querySelectorAll('#features li').length).toBe(6);
    expect(el.querySelector('#how-it-works')).not.toBeNull();
    expect(el.querySelectorAll('#how-it-works li').length).toBe(3);
  });

  it('does not promise out-of-scope features or invent social proof', () => {
    const text = render().textContent!.toLowerCase();
    for (const word of ['online payment', 'sms', 'chat', 'testimonial']) {
      expect(text).not.toContain(word);
    }
  });
});
