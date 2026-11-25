export interface ScheduleItem {
  id: string;
  title: string;
  /** ISO 8601 UTC date-time. */
  startTime: string;
  endTime: string;
  location: string | null;
  notes: string | null;
  overlapsWith: string[];
}

export interface ScheduleInput {
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  notes?: string;
}

export interface ScheduleWarning {
  type: 'OVERLAP';
  itemId: string;
  title: string;
  startTime: string;
  endTime: string;
  message: string;
}

export interface ScheduleSaveResult {
  item: ScheduleItem;
  warnings: ScheduleWarning[];
}
