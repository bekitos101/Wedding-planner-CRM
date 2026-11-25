import { Pipe, PipeTransform } from '@angular/core';
import { formatDate } from '@angular/common';

/** Calendar dates and timestamps shown the same way everywhere, always in UTC: "12 Jun 2027" (NFR-12). */
@Pipe({ name: 'dateOnly' })
export class DateOnlyPipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '';
    // Angular parses a bare "YYYY-MM-DD" in the browser's zone, so formatting it in UTC shifts it by a
    // day east of Greenwich. Build the UTC midnight ourselves.
    const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    if (m) value = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return formatDate(value, 'd MMM y', 'en-GB', 'UTC');
  }
}
