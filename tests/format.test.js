import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatClock,
  formatTaskDate,
  formatTaskLine,
  formatTaskList,
  formatTaskRef,
} from '../src/bot/format.js';

const TASK = {
  id: 'abcd1234-0000-0000-0000-000000000000',
  title: 'Morning Bible study',
  status: 'pending',
  scheduled_start: '2026-11-25T04:00:00.000Z',
  scheduled_end: '2026-11-25T04:30:00.000Z',
};

test('formatClock renders UTC timestamps in the user timezone', () => {
  assert.equal(formatClock('2026-11-25T04:00:00.000Z', 'Africa/Nairobi'), '07:00');
  assert.equal(formatClock('2026-11-25T04:00:00.000Z', 'UTC'), '04:00');
});

test('formatClock returns null for missing or invalid values', () => {
  assert.equal(formatClock(null), null);
  assert.equal(formatClock('not-a-date'), null);
});

test('formatTaskRef uses the first eight characters of the id', () => {
  assert.equal(formatTaskRef(TASK), 'abcd1234');
});

test('formatTaskLine includes time, reference and title', () => {
  const line = formatTaskLine(TASK, 'Africa/Nairobi');

  assert.equal(line, '[abcd1234] 07:00–07:30 · Morning Bible study');
});

test('formatTaskLine marks completed tasks and unscheduled ones', () => {
  assert.match(
    formatTaskLine({ ...TASK, status: 'completed' }, 'Africa/Nairobi'),
    /^✅ /
  );

  assert.match(
    formatTaskLine({ ...TASK, scheduled_start: null }, 'Africa/Nairobi'),
    /unscheduled/
  );
});

test('formatTaskDate renders the weekday in the user timezone', () => {
  assert.equal(formatTaskDate('2026-11-25T04:00:00.000Z', 'Africa/Nairobi'), 'Wed 25 Nov');
});

test('formatTaskLine can include the date for multi-day lists', () => {
  const line = formatTaskLine(TASK, 'Africa/Nairobi', { includeDate: true });

  assert.equal(line, '[abcd1234] Wed 25 Nov 07:00–07:30 · Morning Bible study');
});

test('formatTaskList renders one line per task or a fallback message', () => {
  const list = formatTaskList([TASK, { ...TASK, id: 'ffff0000-0000-0000-0000-000000000000' }], {
    timeZone: 'Africa/Nairobi',
  });

  assert.equal(list.split('\n').length, 2);
  assert.equal(
    formatTaskList([], { emptyMessage: 'No open tasks.' }),
    'No open tasks.'
  );
});
