import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/**
 * On 401 clears the session and sends the user to /login. It must sit inside (after) the
 * ApiError interceptor in the list so it still sees the raw HttpErrorResponse. The error is
 * always re-thrown, so it propagates and gets normalised to ApiError.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const path = req.url.split('?')[0];
  const exempt = path.startsWith('/api/auth/') || (path === '/api/me' && req.method === 'GET');

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !exempt) {
        auth.clearSession();
        const current = router.url;
        if (!current.startsWith('/login') && !current.startsWith('/register')) {
          void router.navigate(['/login'], { queryParams: { returnUrl: current } });
        }
      }
      return throwError(() => err);
    }),
  );
};
