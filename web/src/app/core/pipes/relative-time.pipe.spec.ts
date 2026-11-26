import { relativeTime } from './relative-time.pipe';

describe('relativeTime', () => {
  const now = new Date(2027, 5, 10, 15, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('handles seconds, minutes and hours', () => {
    expect(relativeTime(ago(10_000), now)).toBe('just now');
    expect(relativeTime(ago(60_000), now)).toBe('1 minute ago');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5 minutes ago');
    expect(relativeTime(ago(3_600_000), now)).toBe('1 hour ago');
    expect(relativeTime(ago(2 * 3_600_000), now)).toBe('2 hours ago');
  });

  it('says yesterday for the previous calendar day', () => {
    expect(relativeTime(new Date(2027, 5, 9, 9, 0).toISOString(), now)).toBe('yesterday');
    expect(relativeTime(new Date(2027, 5, 9, 20, 30).toISOString(), new Date(2027, 5, 10, 9, 10))).toBe('yesterday');
  });

  it('uses days then a date', () => {
    expect(relativeTime(new Date(2027, 5, 7, 9, 0).toISOString(), now)).toBe('3 days ago');
    expect(relativeTime(new Date(2027, 4, 1, 9, 0).toISOString(), now)).toBe('1 May 2027');
  });

  it('returns empty for invalid input', () => {
    expect(relativeTime('nope', now)).toBe('');
  });
});
