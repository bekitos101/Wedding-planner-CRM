/** Escapes user data before it goes into an HTML email body. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Single line: names and titles that go into a subject or greeting must never break headers. */
export const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ');
