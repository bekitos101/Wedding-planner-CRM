import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { WeddingContext } from './wedding-context.service';

function guard(requireActive: boolean): CanActivateFn {
  return (route) => {
    const ctx = inject(WeddingContext);
    const router = inject(Router);
    const id = route.paramMap.get('weddingId')!;
    return ctx.load(id).pipe(
      map((w) => {
        // Not found or failed load: let the area show its own page.
        if (!w) return true;
        if (w.role !== 'OWNER') return router.createUrlTree(['/weddings', id]);
        if (requireActive && w.status === 'ARCHIVED') return router.createUrlTree(['/weddings', id]);
        return true;
      }),
    );
  };
}

/** Team page: owners only; team members are redirected to the overview. Cosmetic, backend enforces. */
export const ownerGuard: CanActivateFn = guard(false);
/** Edit page: owners of active weddings only. */
export const editableGuard: CanActivateFn = guard(true);
