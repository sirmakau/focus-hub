import {
  hhmmToMinutes,
  minutesOfDay,
  minutesToHHMM,
} from '../utils/dates.js';

/**
 * Scheduling rules for a personal planner.
 *
 * - fixed commitments are never moved automatically
 * - flexible tasks may be rescheduled
 * - tasks never overlap
 * - sleep is protected (nothing before 06:00 or after 22:00)
 * - a day is not filled simply because a slot exists
 * - the latest energy check-in informs, but is never assumed
 */

export const WAKE_START_MINUTES = 6 * 60;
export const WAKE_END_MINUTES = 22 * 60;
export const BUFFER_MINUTES = 10;
export const MAX_DAY_MINUTES = 8 * 60;
export const SLOT_STEP_MINUTES = 30;
export const SLOT_SUGGESTION_COUNT = 6;
export const LOW_ENERGY_SLOT_COUNT = 4;

export const ENERGY_LEVELS = ['low', 'normal', 'high'];

export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** First interval that overlaps [start, end), or null. */
export function findOverlap(start, end, intervals = []) {
  for (const interval of intervals) {
    if (intervalsOverlap(start, end, interval.start, interval.end)) {
      return interval;
    }
  }
  return null;
}

export function withinWakingHours(startMinutes, durationMinutes) {
  return (
    startMinutes >= WAKE_START_MINUTES &&
    startMinutes + durationMinutes <= WAKE_END_MINUTES
  );
}

/**
 * Convert timestamps into minute-of-day intervals on a local calendar day.
 * Intervals are clamped to the day because an event may start before it.
 */
export function toLocalIntervals(records, timeZone, { startKey, endKey, idKey = 'id' } = {}) {
  const intervals = [];

  for (const record of records) {
    if (!record[startKey] || !record[endKey]) continue;

    const start = minutesOfDay(record[startKey], timeZone);
    const end = minutesOfDay(record[endKey], timeZone);
    const crossesMidnight = new Date(record[endKey]) < new Date(record[startKey]);

    intervals.push({
      id: record[idKey],
      title: record.title,
      start,
      end: crossesMidnight ? 1440 : Math.max(start, end),
    });
  }

  return intervals;
}

/**
 * Propose non-overlapping start times for a task of a given length.
 *
 * @returns {{
 *   slots: Array<{start: string, end: string}>,
 *   blockedReason: string | null,
 *   dayLoadMinutes: number,
 *   energyLevel: string | null,
 * }}
 */
export function suggestSlots({
  durationMinutes,
  busy = [],
  energyLevel = null,
  maxSlots = SLOT_SUGGESTION_COUNT,
}) {
  const duration = Number(durationMinutes);

  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      slots: [],
      blockedReason: 'Choose how long the task will take first.',
      dayLoadMinutes: 0,
      energyLevel,
    };
  }

  const dayLoadMinutes = busy.reduce(
    (total, interval) => total + Math.max(0, interval.end - interval.start),
    0
  );

  if (dayLoadMinutes + duration > MAX_DAY_MINUTES) {
    return {
      slots: [],
      blockedReason:
        'That day is already full. Pick another day rather than stretching it further.',
      dayLoadMinutes,
      energyLevel,
    };
  }

  const limit =
    energyLevel === 'low' ? Math.min(maxSlots, LOW_ENERGY_SLOT_COUNT) : maxSlots;

  const padded = busy.map((interval) => ({
    ...interval,
    start: interval.start - BUFFER_MINUTES,
    end: interval.end + BUFFER_MINUTES,
  }));

  const slots = [];

  for (
    let start = WAKE_START_MINUTES;
    start + duration <= WAKE_END_MINUTES && slots.length < limit;
    start += SLOT_STEP_MINUTES
  ) {
    const end = start + duration;
    if (findOverlap(start, end, padded)) continue;

    slots.push({ start: minutesToHHMM(start), end: minutesToHHMM(end) });
  }

  return {
    slots,
    blockedReason: slots.length === 0 ? 'No free slot fits that task on this day.' : null,
    dayLoadMinutes,
    energyLevel,
  };
}

export function createScheduleService() {
  return {
    /**
     * Automatic rescheduling is limited to flexible tasks with it enabled.
     */
    mayAutoReschedule(task) {
      if (!task) return false;
      if (task.scheduling_type !== 'flexible') return false;
      return task.auto_reschedule !== false;
    },

    suggestSlots,
    findOverlap,
    withinWakingHours,
    toLocalIntervals,
  };
}

export { hhmmToMinutes, minutesToHHMM };
