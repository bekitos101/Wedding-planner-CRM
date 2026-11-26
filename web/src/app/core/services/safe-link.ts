import { SAFE_URL } from '../auth/safe-return-url';

/** Only in-app paths are followed; anything else falls back to the notifications page. */
export function safeAppLink(link: string): string {
  return SAFE_URL.test(link) ? link : '/notifications';
}
