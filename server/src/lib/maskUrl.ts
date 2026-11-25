/** Masks secrets that appear in URLs (invitation tokens) before logging (NFR-06). */
export function maskUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/(\/rsvp\/)[^/?#]+/g, '$1[Redacted]');
}
