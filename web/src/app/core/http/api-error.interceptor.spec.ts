import { HttpErrorResponse } from '@angular/common/http';
import { toApiError } from './api-error.interceptor';

describe('toApiError', () => {
  it('passes through the server error shape', () => {
    const body = { error: { code: 'VALIDATION_ERROR', message: 'Bad', fields: { a: 'x' } } };
    expect(toApiError(new HttpErrorResponse({ status: 400, error: body }))).toEqual(body);
  });

  it('maps network failures to a friendly message', () => {
    expect(toApiError(new HttpErrorResponse({ status: 0 })).error.code).toBe('NETWORK');
  });
});
