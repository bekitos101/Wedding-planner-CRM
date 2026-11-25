import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { navigateToReturnUrl, safeReturnUrl } from './safe-return-url';

describe('safeReturnUrl', () => {
  it('rejects protocol-relative and backslash URLs', () => {
    expect(safeReturnUrl('//evil.example')).toBe('/');
    expect(safeReturnUrl('/\\evil')).toBe('/');
  });

  it('rejects absolute and empty URLs', () => {
    expect(safeReturnUrl('https://x')).toBe('/');
    expect(safeReturnUrl('')).toBe('/');
    expect(safeReturnUrl(null)).toBe('/');
  });

  it('accepts same-origin paths', () => {
    expect(safeReturnUrl('/profile')).toBe('/profile');
    expect(safeReturnUrl('/weddings/1?x=2')).toBe('/weddings/1?x=2');
  });
});

describe('navigateToReturnUrl', () => {
  it('falls back to / when navigation throws', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const router = TestBed.inject(Router);
    const spy = vi
      .spyOn(router, 'navigateByUrl')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(true);
    await navigateToReturnUrl(router, '/profile');
    expect(spy).toHaveBeenNthCalledWith(1, '/profile');
    expect(spy).toHaveBeenNthCalledWith(2, '/');
  });
});
