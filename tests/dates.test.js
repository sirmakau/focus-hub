import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  formatDateLong,
  isDateString,
  isTimeString,
  parseUserDate,
  startOfWeek,
  todayInZone,
  weekDates,
  zonedDateOf,
  zonedWallTimeToUtc,
} from '../src/utils/dates.js';

test('startOfWeek returns the Monday of the week', () => {
  assert.equal(startOfWeek('2026-11-25'), '2026-11-23');
  assert.equal(startOfWeek('2026-11-23'), '2026-11-23');
  assert.equal(startOfWeek('2026-11-29'), '2026-11-23');
});

test('weekDates lists Monday through Sunday', () => {
  assert.deepEqual(weekDates('2026-11-23'), [
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
    '2026-11-26',
    '2026-11-27',
    '2026-11-28',
    '2026-11-29',
  ]);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});

test('todayInZone uses the user timezone rather than UTC', () => {
  const instant = new Date('2026-11-25T22:30:00.000Z');

  assert.equal(todayInZone('Africa/Nairobi', instant), '2026-11-26');
  assert.equal(todayInZone('UTC', instant), '2026-11-25');
});

test('zonedWallTimeToUtc converts Nairobi wall time to UTC', () => {
  const result = zonedWallTimeToUtc('2026-11-25', '07:00', 'Africa/Nairobi');

  assert.equal(result.toISOString(), '2026-11-25T04:00:00.000Z');
});

test('zonedWallTimeToUtc respects daylight saving transitions', () => {
  // London moves to BST on 2026-03-29.
  assert.equal(
    zonedWallTimeToUtc('2026-03-28', '09:00', 'Europe/London').toISOString(),
    '2026-03-28T09:00:00.000Z'
  );
  assert.equal(
    zonedWallTimeToUtc('2026-03-29', '09:00', 'Europe/London').toISOString(),
    '2026-03-29T08:00:00.000Z'
  );
});

test('zonedDateOf reports the local calendar date of a timestamp', () => {
  assert.equal(
    zonedDateOf('2026-11-25T22:30:00.000Z', 'Africa/Nairobi'),
    '2026-11-26'
  );
});

test('date and time validation reject impossible values', () => {
  assert.equal(isDateString('2026-02-28'), true);
  assert.equal(isDateString('2026-02-31'), false);
  assert.equal(isTimeString('09:30'), true);
  assert.equal(isTimeString('24:00'), false);
});

test('parseUserDate accepts short and full dates', () => {
  assert.equal(parseUserDate('28/11', { referenceDate: '2026-11-25' }), '2026-11-28');
  assert.equal(parseUserDate('2026-12-01'), '2026-12-01');
  assert.equal(parseUserDate('nonsense'), null);
});

test('formatDateLong renders a stable calendar date', () => {
  assert.equal(formatDateLong('2026-11-30'), 'Monday 30 November 2026');
});
