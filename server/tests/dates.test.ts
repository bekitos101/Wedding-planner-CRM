import { describe, expect, it } from 'vitest';
import { isRsvpOpen, parseDateOnly, toDateOnly, todayUtc } from '../src/lib/dates.js';

describe('parseDateOnly / toDateOnly (FR-07)', () => {
  it('FR-07: accepts strict YYYY-MM-DD and round-trips', () => {
    const d = parseDateOnly('2027-06-12');
    expect(d?.toISOString()).toBe('2027-06-12T00:00:00.000Z');
    expect(toDateOnly(d!)).toBe('2027-06-12');
    expect(parseDateOnly('2028-02-29')).not.toBeNull(); // leap day
  });

  it.each(['2027-02-30', '2027-13-01', '2027-6-1', '2027-06-12T00:00:00Z', ' 2027-06-12', '2027-06-12 ', '1999-12-31', '2101-01-01', '', 'tomorrow', '2027-02-29'])(
    'FR-07: rejects %j',
    (s) => expect(parseDateOnly(s)).toBeNull(),
  );

  it('FR-07: range edges are inclusive', () => {
    expect(parseDateOnly('2000-01-01')).not.toBeNull();
    expect(parseDateOnly('2100-12-31')).not.toBeNull();
  });

  it('FR-07: non-strings are rejected', () => {
    expect(parseDateOnly(20270612)).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(new Date())).toBeNull();
  });
});

describe('isRsvpOpen (FR-25, FR-26, BR-06)', () => {
  const deadline = parseDateOnly('2027-05-12')!;

  it('FR-25: open the day before the deadline', () => {
    expect(isRsvpOpen(deadline, new Date('2027-05-11T23:59:59.999Z'))).toBe(true);
  });

  it('FR-25: open through the whole deadline day (00:00:00 to 23:59:59.999 UTC)', () => {
    expect(isRsvpOpen(deadline, new Date('2027-05-12T00:00:00.000Z'))).toBe(true);
    expect(isRsvpOpen(deadline, new Date('2027-05-12T12:00:00.000Z'))).toBe(true);
    expect(isRsvpOpen(deadline, new Date('2027-05-12T23:59:59.999Z'))).toBe(true);
  });

  it('BR-06: closed from the first instant of the next UTC day', () => {
    expect(isRsvpOpen(deadline, new Date('2027-05-13T00:00:00.000Z'))).toBe(false);
    expect(isRsvpOpen(deadline, new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('BR-06: uses the UTC day regardless of the offset in the clock value', () => {
    // 2027-05-12T23:30-05:00 is 2027-05-13T04:30Z -> already closed in UTC
    expect(isRsvpOpen(deadline, new Date('2027-05-12T23:30:00-05:00'))).toBe(false);
  });

  it('todayUtc returns UTC midnight of the given instant', () => {
    expect(todayUtc(new Date('2027-05-12T23:59:59.999Z')).toISOString()).toBe('2027-05-12T00:00:00.000Z');
  });
});
