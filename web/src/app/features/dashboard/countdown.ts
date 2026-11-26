/** "in 205 days" / "tomorrow" / "today" / "yesterday" / "3 days ago" from daysUntilWedding. */
export function countdownText(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
