import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findOverlap,
  suggestSlots,
  withinWakingHours,
} from '../src/services/schedule.service.js';

test('slots never overlap existing work and keep a buffer', () => {
  const busy = [{ id: 't1', title: 'Lecture', start: 9 * 60, end: 10 * 60 }];

  const result = suggestSlots({ durationMinutes: 60, busy });

  const starts = result.slots.map((slot) => slot.start);
  assert.deepEqual(starts.slice(0, 4), ['06:00', '06:30', '07:00', '07:30']);
  assert.ok(!starts.includes('08:00'));
  assert.ok(!starts.includes('08:30'));
  assert.ok(!starts.includes('09:00'));
  assert.ok(starts.includes('10:30'));
});

test('slots stay inside waking hours', () => {
  const result = suggestSlots({ durationMinutes: 120, busy: [] });

  for (const slot of result.slots) {
    const [hour, minute] = slot.end.split(':').map(Number);
    assert.ok(hour * 60 + minute <= 22 * 60);
  }
});

test('a full day is reported instead of overloading it', () => {
  const busy = [{ title: 'Deep work', start: 6 * 60, end: 12 * 60 }];

  const result = suggestSlots({ durationMinutes: 240, busy });

  assert.deepEqual(result.slots, []);
  assert.match(result.blockedReason, /already full/);
});

test('low energy offers fewer suggestions', () => {
  const normal = suggestSlots({ durationMinutes: 30, busy: [] });
  const low = suggestSlots({ durationMinutes: 30, busy: [], energyLevel: 'low' });

  assert.ok(normal.slots.length > low.slots.length);
  assert.equal(low.slots.length, 4);
});

test('no energy check-in is never assumed to mean high energy', () => {
  const result = suggestSlots({ durationMinutes: 30, busy: [], energyLevel: null });

  assert.equal(result.energyLevel, null);
  assert.equal(result.slots.length, 6);
});

test('overlap detection and waking hours are exposed as helpers', () => {
  assert.equal(
    findOverlap(540, 600, [{ start: 570, end: 630 }])?.start,
    570
  );
  assert.equal(findOverlap(540, 600, [{ start: 660, end: 720 }]), null);
  assert.equal(withinWakingHours(6 * 60, 60), true);
  assert.equal(withinWakingHours(5 * 60, 60), false);
  assert.equal(withinWakingHours(22 * 60, 30), false);
});
