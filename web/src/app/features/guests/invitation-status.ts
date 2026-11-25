import { InvitationSummary } from '../../core/models/guest';

export interface InvitationChip {
  label: string;
  cls: string;
  /** Extra detail, e.g. the delivery error for a failed send. */
  detail: string | null;
}

/** Maps the invitation summary to the one chip shown in the guest list. */
export function invitationChip(inv: InvitationSummary | null): InvitationChip {
  if (!inv) return { label: 'Not sent', cls: 'chip-neutral', detail: null };
  switch (inv.status) {
    case 'REVOKED':
      return { label: 'Revoked', cls: 'chip-neutral', detail: null };
    case 'FAILED':
      return { label: 'Failed', cls: 'chip-danger', detail: inv.lastError };
    case 'SENT':
      return { label: 'Sent', cls: 'chip-success', detail: null };
    default:
      return { label: 'Pending', cls: 'chip-warning', detail: null };
  }
}
