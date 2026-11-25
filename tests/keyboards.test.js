import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDayKeyboard,
  decodeCallbackData,
  editMenuKeyboard,
  eventEditMenuKeyboard,
  eventKeyboard,
  flowConfirmKeyboard,
  flowDurationKeyboard,
  rescheduleConfirmKeyboard,
  scheduleConfirmKeyboard,
  scheduleDateKeyboard,
  slotKeyboard,
  weekKeyboard,
} from '../src/bot/keyboards.js';

function buttons(keyboard) {
  return keyboard.inline_keyboard.flat();
}

test('week keyboard exposes seven day buttons plus navigation', () => {
  const week = {
    days: [
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ].map((date, index) => ({
      date,
      label: `Mon ${23 + index} Nov`,
      count: index,
    })),
  };

  const data = buttons(weekKeyboard(week)).map((item) => item.callback_data);
  const dayButtons = data.filter((value) => value.startsWith('d:'));

  assert.equal(dayButtons.length, 7);
  assert.ok(data.includes('home'));
  assert.ok(data.includes('w:-1'));
  assert.ok(data.includes('w:1'));
  assert.ok(data.includes('add'));
});

test('every generated callback_data fits in 64 bytes and decodes', () => {
  const keyboards = [
    addDayKeyboard({ monday: '2026-11-23' }),
    editMenuKeyboard({
      reference: 'abcd1234-0000-0000-0000-000000000000',
      categories: [{ id: '11112222-3333-4444-5555-666677778888', name: 'Faith' }],
    }),
    flowConfirmKeyboard(),
    flowDurationKeyboard(),
    rescheduleConfirmKeyboard({
      reference: 'abcd1234',
      date: '2026-11-25',
      time: '09:30',
    }),
    slotKeyboard({
      reference: 'abcd1234',
      date: '2026-11-25',
      slots: [{ start: '09:00', end: '10:00' }],
      backData: 't:abcd1234',
    }),
    eventKeyboard({
      event: { id: 'abcd1234', title: 'Lecture', is_fixed: true },
      backData: 'd:2026-11-25',
      undoData: 'undo:abcd1234:11112222',
    }),
    eventEditMenuKeyboard({ reference: 'abcd1234' }),
    scheduleDateKeyboard({
      reference: 'abcd1234',
      dates: ['2026-11-25', '2026-11-26'],
    }),
    scheduleConfirmKeyboard({ hasConflict: true }),
    scheduleConfirmKeyboard({ hasConflict: false }),
  ];

  for (const keyboard of keyboards) {
    for (const item of buttons(keyboard)) {
      assert.ok(
        Buffer.byteLength(item.callback_data, 'utf8') <= 64,
        `${item.callback_data} exceeds the Telegram limit`
      );
      assert.ok(decodeCallbackData(item.callback_data), `${item.callback_data} does not decode`);
    }
  }
});

test('decodeCallbackData parses parameters', () => {
  assert.deepEqual(decodeCallbackData('d:2026-11-25'), {
    action: 'day',
    params: ['2026-11-25'],
  });

  assert.deepEqual(decodeCallbackData('rss:abcd1234:2026-11-25:09:30'), {
    action: 'rescheduleSlot',
    params: ['abcd1234', '2026-11-25', '09:30'],
  });

  assert.deepEqual(decodeCallbackData('rsy:abcd1234:2026-11-25:09:30'), {
    action: 'rescheduleYes',
    params: ['abcd1234', '2026-11-25', '09:30'],
  });

  assert.deepEqual(decodeCallbackData('ft:fixed'), {
    action: 'flowType',
    params: ['fixed'],
  });

  assert.deepEqual(decodeCallbackData('ey:abcd1234:flexible'), {
    action: 'editType',
    params: ['abcd1234', 'flexible'],
  });

  assert.deepEqual(decodeCallbackData('undo:abcd1234:11112222'), {
    action: 'undoTask',
    params: ['abcd1234', '11112222'],
  });

  assert.deepEqual(decodeCallbackData('esd:abcd1234:2026-11-25'), {
    action: 'scheduleDate',
    params: ['abcd1234', '2026-11-25'],
  });
});

test('decodeCallbackData rejects unknown, malformed and oversized data', () => {
  assert.equal(decodeCallbackData('nonsense'), null);
  assert.equal(decodeCallbackData('d:not-a-date'), null);
  assert.equal(decodeCallbackData('ep:abcd1234:critical'), null);
  assert.equal(decodeCallbackData('x'.repeat(65)), null);
  assert.equal(decodeCallbackData(undefined), null);
});
