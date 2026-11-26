/**
 * The one floor-percentage rule (NFR-12): floor(part / whole x 100) with integer math, 0 when there
 * is no whole, so 100 only appears when everything is done. Used by the wedding list progress, the
 * dashboard and the guest report. (The budget report's shareOfCommitted divides Decimal money
 * amounts, so it applies the same floor with Prisma.Decimal instead of this number helper.)
 */
export const percentOf = (part: number, whole: number): number => (whole === 0 ? 0 : Math.floor((part * 100) / whole));
