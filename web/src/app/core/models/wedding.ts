/** Calendar date "YYYY-MM-DD" (2000-01-01..2100-12-31), no time part. */
export type DateOnly = string;
export type WeddingRole = 'OWNER' | 'TEAM_MEMBER';
export type WeddingStatus = 'ACTIVE' | 'ARCHIVED';
export type WeddingListStatus = 'active' | 'archived';

export interface Progress {
  completed: number;
  total: number;
  percent: number;
}

export interface Wedding {
  id: string;
  coupleNames: string;
  weddingDate: DateOnly;
  location: string;
  /** Money string, e.g. "25000.00". */
  totalBudget: string;
  rsvpDeadline: DateOnly;
  status: WeddingStatus;
  archivedAt: string | null;
  createdAt: string;
  owner: { id: string; name: string };
  /** The caller's role in this wedding. */
  role: WeddingRole;
  progress: Progress;
}

export interface WeddingInput {
  coupleNames: string;
  weddingDate: DateOnly;
  location: string;
  totalBudget: string;
  rsvpDeadline: DateOnly;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: 'TEAM_MEMBER';
  status: 'ACTIVE' | 'REVOKED';
  addedAt: string;
  revokedAt: string | null;
}
