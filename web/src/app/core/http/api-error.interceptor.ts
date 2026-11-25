import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { ApiError } from '../models/api-error';

/** Normalises any HTTP failure into the ApiError shape so components show `error.message`. */
export function toApiError(err: HttpErrorResponse): ApiError {
  const body = err.error as Partial<ApiError> | null;
  if (body && typeof body === 'object' && body.error?.message) {
    return body as ApiError;
  }
  if (err.status === 0) {
    return { error: { code: 'NETWORK', message: 'Cannot reach the server. Please try again.' } };
  }
  return { error: { code: 'UNKNOWN', message: 'Something went wrong. Please try again.' } };
}

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((err: unknown) =>
      throwError(() => (err instanceof HttpErrorResponse ? toApiError(err) : err)),
    ),
  );
