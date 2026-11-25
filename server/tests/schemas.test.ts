import { describe, expect, it } from 'vitest';
import { dateOnly, email, formatDateOnly, formatMoney, money, optionalText, requiredText } from '../src/lib/schemas.js';

describe('shared request schemas (NFR-04)', () => {
  it('money: accepts strings/numbers up to 10 digits and 2 decimals, returns Decimal', () => {
    expect(formatMoney(money('Amount').parse('1250.5'))).toBe('1250.50');
    expect(formatMoney(money('Amount').parse(0.1))).toBe('0.10');
    for (const bad of ['-1', '1.234', '1e3', '12345678901', '', 'abc']) {
      expect(money('Amount').safeParse(bad).success).toBe(false);
    }
  });

  it('dateOnly: strict YYYY-MM-DD within range', () => {
    expect(formatDateOnly(dateOnly('Date').parse('2027-06-19'))).toBe('2027-06-19');
    for (const bad of ['2027-02-30', '2027-06-19T10:00', '1999-12-31', '2101-01-01', '19/06/2027']) {
      expect(dateOnly('Date').safeParse(bad).success).toBe(false);
    }
  });

  it('text and email helpers trim, limit and normalise', () => {
    expect(requiredText('Name', 5).safeParse('   ').success).toBe(false);
    expect(requiredText('Name', 5).safeParse('abcdef').success).toBe(false);
    expect(optionalText('Notes', 10).parse('  ')).toBeNull();
    expect(optionalText('Notes', 10).parse(null)).toBeNull();
    expect(email().parse('  Anna@Example.COM ')).toBe('anna@example.com');
    expect(email().safeParse('a@b.com\r\nBcc: x@y.com').success).toBe(false);
  });
});
