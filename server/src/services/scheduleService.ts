import type { ScheduleItem } from '@prisma/client';
import { notFound, validationError } from '../lib/errors.js';
import { scheduleRepository } from '../repositories/scheduleRepository.js';

const NOT_FOUND = 'Schedule item not found.';
const END_MESSAGE = 'End time must be after start time.';

export interface OverlapWarning {
  type: 'OVERLAP';
  itemId: string;
  title: string;
  startTime: string;
  endTime: string;
  message: string;
}

export interface ScheduleInput {
  title: string;
  startTime: Date;
  endTime: Date;
  location: string | null;
  notes: string | null;
}

/** a.start < b.end AND b.start < a.end (back-to-back does not overlap). */
type Span = Pick<ScheduleItem, 'id' | 'startTime' | 'endTime'>;
const overlaps = (a: Span, b: Span) => a.startTime < b.endTime && b.startTime < a.endTime;

function toDto(i: ScheduleItem, overlapsWith: string[]) {
  return {
    id: i.id,
    title: i.title,
    startTime: i.startTime.toISOString(),
    endTime: i.endTime.toISOString(),
    location: i.location,
    notes: i.notes,
    overlapsWith,
  };
}
export type ScheduleItemDto = ReturnType<typeof toDto>;

/**
 * One pass over the list sorted by start time: for each item only later items that start before
 * it ends can overlap it, so the inner scan stops early. Results are mirrored to both sides.
 */
export function computeOverlaps(sorted: Span[]): Map<string, string[]> {
  const map = new Map<string, string[]>(sorted.map((i) => [i.id, []]));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j]!.startTime < sorted[i]!.endTime; j++) {
      if (overlaps(sorted[i]!, sorted[j]!)) {
        map.get(sorted[i]!.id)!.push(sorted[j]!.id);
        map.get(sorted[j]!.id)!.push(sorted[i]!.id);
      }
    }
  }
  return map;
}

function assertOrder(start: Date, end: Date) {
  if (!(start < end)) throw validationError(END_MESSAGE, { endTime: END_MESSAGE });
}

/** Builds the {item, warnings} response for a saved item from the current list. */
async function respond(weddingId: string, id: string) {
  const sorted = await scheduleRepository.list(weddingId);
  const map = computeOverlaps(sorted);
  const byId = new Map(sorted.map((i) => [i.id, i]));
  const own = byId.get(id);
  if (!own) throw notFound(NOT_FOUND);
  const overlapIds = map.get(id) ?? [];
  const warnings: OverlapWarning[] = overlapIds.map((oid) => {
    const o = byId.get(oid)!;
    return {
      type: 'OVERLAP',
      itemId: o.id,
      title: o.title,
      startTime: o.startTime.toISOString(),
      endTime: o.endTime.toISOString(),
      message: `Overlaps with "${o.title}".`,
    };
  });
  return { item: toDto(own, overlapIds), warnings };
}

export const scheduleService = {
  async list(weddingId: string): Promise<ScheduleItemDto[]> {
    const sorted = await scheduleRepository.list(weddingId);
    const map = computeOverlaps(sorted);
    return sorted.map((i) => toDto(i, map.get(i.id) ?? []));
  },

  async create(weddingId: string, input: ScheduleInput) {
    assertOrder(input.startTime, input.endTime);
    const row = await scheduleRepository.create(weddingId, input);
    return respond(weddingId, row.id);
  },

  async update(weddingId: string, id: string, patch: Partial<ScheduleInput>) {
    const current = await scheduleRepository.find(weddingId, id);
    if (!current) throw notFound(NOT_FOUND);
    // Validate the merged values so a PATCH of one time cannot invert the interval.
    assertOrder(patch.startTime ?? current.startTime, patch.endTime ?? current.endTime);
    if (!(await scheduleRepository.update(weddingId, id, patch))) throw notFound(NOT_FOUND);
    return respond(weddingId, id);
  },

  async remove(weddingId: string, id: string): Promise<void> {
    if (!(await scheduleRepository.delete(weddingId, id))) throw notFound(NOT_FOUND);
  },
};
