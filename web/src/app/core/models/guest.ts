import { DateOnly } from './wedding';

export type RsvpStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';
export type InvitationStatus = 'SENT' | 'FAILED' | 'PENDING' | 'REVOKED';

export interface InvitationSummary {
  status: InvitationStatus;
  deliveryStatus: string;
  attemptCount: number;
  lastSentAt: string | null;
  lastError: string | null;
  revokedAt: string | null;
}

export interface Guest {
  id: string;
  name: string;
  email: string;
  rsvpStatus: RsvpStatus;
  dietaryRequirements: string | null;
  respondedAt: string | null;
  createdAt: string;
  invitation: InvitationSummary | null;
}

export interface GuestSummary {
  total: number;
  pending: number;
  accepted: number;
  declined: number;
}

export interface GuestList {
  guests: Guest[];
  summary: GuestSummary;
}

export interface GuestInput {
  name: string;
  email: string;
  dietaryRequirements?: string;
  rsvpStatus?: RsvpStatus;
}

export interface RsvpView {
  guestName: string;
  coupleNames: string;
  weddingDate: DateOnly;
  location: string;
  rsvpDeadline: DateOnly;
  rsvpStatus: RsvpStatus;
  dietaryRequirements: string | null;
}
