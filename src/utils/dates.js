/**
 * Timezone-aware date helpers.
 *
 * The planner works in two spaces:
 * - "dates" are plain calendar strings (`YYYY-MM-DD`) in the user's timezone
 * - timestamps are real instants (Date / TIMESTAMPTZ)
 *
 * Everything here is pure: no dependency on the system timezone or a date
 * library, only `Intl`.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const WEEKDAYS_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const DEFAULT_TIMEZONE = 'Africa/Nairobi';

export function isDateString(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }
  // Reject impossible calendar dates such as 2026-02-31.
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isTimeString(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function addMonths(date, months) {
  const [year, month] = date.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + months);
  return base.toISOString().slice(0, 10);
}

/** Monday-based weekday index: 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(date) {
  const [year, month, day] = date.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function startOfWeek(date) {
  return addDays(date, -weekdayIndex(date));
}

export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function partsFor(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  if (values.hour === 24) values.hour = 0;
  return values;
}

/** Calendar date (`YYYY-MM-DD`) of an instant in a timezone. */
export function zonedDateOf(value, timeZone = DEFAULT_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const { year, month, day } = partsFor(date, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function todayInZone(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  return zonedDateOf(now, timeZone);
}

/** Minutes since local midnight for an instant. */
export function minutesOfDay(value, timeZone = DEFAULT_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const { hour, minute } = partsFor(date, timeZone);
  return hour * 60 + minute;
}

function offsetMinutes(utcDate, timeZone) {
  const { year, month, day, hour, minute, second } = partsFor(utcDate, timeZone);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return (asUtc - utcDate.getTime()) / 60000;
}

/**
 * Convert a wall-clock time on a calendar date in a timezone to a UTC instant.
 * Two passes handle DST transitions.
 */
export function zonedWallTimeToUtc(date, time = '00:00', timeZone = DEFAULT_TIMEZONE) {
  if (!isDateString(date) || !isTimeString(time)) {
    throw new Error(`Invalid date/time: ${date} ${time}`);
  }

  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);

  let offset = offsetMinutes(new Date(naive), timeZone);
  let result = new Date(naive - offset * 60000);

  const corrected = offsetMinutes(result, timeZone);
  if (corrected !== offset) {
    result = new Date(naive - corrected * 60000);
  }

  return result;
}

/** First instant of a calendar date in a timezone. */
export function startOfZonedDay(date, timeZone = DEFAULT_TIMEZONE) {
  return zonedWallTimeToUtc(date, '00:00', timeZone);
}

/** First instant of the following calendar date in a timezone. */
export function endOfZonedDay(date, timeZone = DEFAULT_TIMEZONE) {
  return zonedWallTimeToUtc(addDays(date, 1), '00:00', timeZone);
}

export function hhmmToMinutes(value) {
  if (!isTimeString(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function minutesToHHMM(minutes) {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatDateLong(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(new Date(`${date}T00:00:00Z`));

  const value = (type) => parts.find((part) => part.type === type)?.value ?? '';

  return [value('weekday'), value('day'), value('month'), value('year')]
    .filter(Boolean)
    .join(' ');
}

export function formatDateShort(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatWeekday(date) {
  return WEEKDAYS_LONG[weekdayIndex(date)];
}

export function formatWeekRange(monday) {
  const sunday = addDays(monday, 6);
  return `${formatDateShort(monday)} – ${formatDateShort(sunday)}`;
}

/** Parse `DD/MM`, `DD-MM` or `YYYY-MM-DD` typed by the user in their week. */
export function parseUserDate(input, { referenceDate, timeZone = DEFAULT_TIMEZONE } = {}) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  if (isDateString(text)) {
    return text;
  }

  const match = text.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const reference =
    referenceDate ?? todayInZone(timeZone);
  const year = Number(reference.slice(0, 4));

  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isDateString(candidate)) return null;

  return candidate;
}
