/** `datetime-local` value ("2027-06-19T14:00", browser-local) to an ISO string with a zone (UTC "Z"). */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO date-time from the API to a `datetime-local` value in the browser's timezone. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
