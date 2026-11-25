import { Pipe, PipeTransform } from '@angular/core';

const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });

/** Formats a money string ("25000.00") for display: "€25,000.00". Used everywhere (NFR-12). */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    return Number.isFinite(n) ? formatter.format(n) : String(value);
  }
}
