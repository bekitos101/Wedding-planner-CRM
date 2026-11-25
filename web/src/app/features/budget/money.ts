/** Display-only: share of the agreed amount already paid, 0..100. Real sums are computed by the server. */
export function paidPercent(paid: string, agreed: string): number {
  const a = Number(agreed);
  if (!(a > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(paid) / a) * 100)));
}
