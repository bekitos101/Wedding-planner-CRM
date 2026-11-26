import { BudgetReport, GuestReport } from '../../core/models/reports';

const BOM = '﻿';

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Text cells starting with a formula trigger get a leading quote (CWE-1236); plain numbers/money are untouched. */
function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v !== 'number' && !PLAIN_NUMBER.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Pure CSV builder: RFC 4180 escaping, CRLF rows, UTF-8 BOM so Excel reads accents. */
export function buildCsv(rows: (string | number | null | undefined)[][]): string {
  return BOM + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export const RSVP_LABEL = { PENDING: 'Pending', ACCEPTED: 'Accepted', DECLINED: 'Declined' } as const;
export const INVITATION_LABEL = { NOT_SENT: 'Not sent', SENT: 'Sent', FAILED: 'Failed', REVOKED: 'Revoked' } as const;

export function guestsCsv(report: GuestReport): string {
  return buildCsv([
    ['Name', 'Email', 'RSVP', 'Responded', 'Dietary requirements', 'Invitation'],
    ...report.guests.map((g) => [
      g.name,
      g.email,
      RSVP_LABEL[g.rsvpStatus],
      g.respondedAt ? new Date(g.respondedAt).toISOString().slice(0, 10) : '',
      g.dietaryRequirements ?? '',
      INVITATION_LABEL[g.invitationStatus],
    ]),
  ]);
}

export function budgetCsv(report: BudgetReport): string {
  return buildCsv([
    ['Category', 'Expenses', 'Committed', 'Paid', 'Outstanding', 'Share of committed (%)'],
    ...report.byCategory.map((c) => [c.category, c.expenseCount, c.committed, c.paid, c.outstanding, c.shareOfCommitted]),
    [
      'Total',
      report.byCategory.reduce((n, c) => n + c.expenseCount, 0),
      report.totals.committed,
      report.totals.paid,
      report.totals.outstanding,
      '',
    ],
  ]);
}

/** "Emma & Daniel" + "guests" + date -> "emma-daniel-guests-2026-11-25.csv". */
export function csvFilename(coupleNames: string, kind: string, today = new Date().toISOString().slice(0, 10)): string {
  const slug = coupleNames
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'wedding'}-${kind}-${today}.csv`;
}

export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
