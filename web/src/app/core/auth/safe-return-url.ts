import { Router } from '@angular/router';

/** Only same-origin absolute paths are allowed: starts with "/" but not "//" or "/\". */
const SAFE_URL = /^\/(?![\/\\])/;

export function safeReturnUrl(url: string | null | undefined): string {
  return url && SAFE_URL.test(url) ? url : '/weddings';
}

/** Navigates to the sanitised return URL; falls back to /weddings if that navigation fails. */
export async function navigateToReturnUrl(
  router: Router,
  rawUrl: string | null | undefined,
): Promise<void> {
  const target = safeReturnUrl(rawUrl);
  try {
    const ok = await router.navigateByUrl(target);
    if (!ok && target !== '/weddings') await router.navigateByUrl('/weddings');
  } catch {
    await router.navigateByUrl('/weddings');
  }
}
