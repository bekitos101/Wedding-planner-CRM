import { RsvpStatus } from './guest';

export type ReportInvitationStatus = 'NOT_SENT' | 'SENT' | 'FAILED' | 'REVOKED';

export interface GuestReport {
  summary: { total: number; pending: number; accepted: number; declined: number; responseRate: number };
  dietary: { name: string; rsvpStatus: RsvpStatus; dietaryRequirements: string }[];
  guests: {
    name: string;
    email: string;
    rsvpStatus: RsvpStatus;
    respondedAt: string | null;
    dietaryRequirements: string | null;
    invitationStatus: ReportInvitationStatus;
  }[];
}

export interface BudgetReport {
  totals: { totalBudget: string; committed: string; paid: string; outstanding: string; remaining: string };
  byCategory: {
    category: string;
    expenseCount: number;
    committed: string;
    paid: string;
    outstanding: string;
    shareOfCommitted: number;
  }[];
}
