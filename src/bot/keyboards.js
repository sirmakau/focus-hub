/**
 * Inline keyboard construction and compact callback-data parsing.
 *
 * Telegram caps `callback_data` at 64 bytes, so tokens stay short:
 * an 8-character task reference plus a short action and, when needed,
 * a 10-character date or a 5-character time.
 */

import { formatDateShort, weekDates } from '../utils/dates.js';

const MAX_BUTTON_LABEL = 48;

function shorten(text) {
  const value = String(text ?? '');
  return value.length > MAX_BUTTON_LABEL
    ? `${value.slice(0, MAX_BUTTON_LABEL - 1)}…`
    : value;
}

function button(text, data) {
  return { text: shorten(text), callback_data: data };
}

function keyboard(rows) {
  return { inline_keyboard: rows.map((row) => row.filter(Boolean)) };
}

export function weekKeyboard(week) {
  const days = week.days;

  return keyboard([
    days.slice(0, 3).map((day) =>
      button(`${day.label.split(' ')[0]} ${day.label.split(' ')[1]} · ${day.count}`, `d:${day.date}`)
    ),
    days.slice(3, 6).map((day) =>
      button(`${day.label.split(' ')[0]} ${day.label.split(' ')[1]} · ${day.count}`, `d:${day.date}`)
    ),
    [button(`${days[6].label} · ${days[6].count}`, `d:${days[6].date}`)],
    [button('➕ Add task', 'add'), button('📍 Today', 'today')],
    [button('🗂 All tasks', 'all:0'), button('📥 Unscheduled', 'u')],
    [button('📊 Weekly review', 'rev')],
    [
      button('◀ Previous', 'w:-1'),
      button('This week', 'home'),
      button('Next ▶', 'w:1'),
    ],
  ]);
}

export function dayKeyboard({ date, tasks = [] }) {
  const rows = tasks.map((task) => [button(`Open: ${task.title}`, `t:${task.id.slice(0, 8)}`)]);

  rows.push([button('➕ Add task', `add:${date}`)]);
  rows.push([button('⬅ Back to week', 'home')]);

  return keyboard(rows);
}

export function taskKeyboard({ task, backData }) {
  const rows = [];

  if (task.status === 'pending' || task.status === 'in_progress') {
    rows.push([
      button('✅ Complete', `done:${task.id.slice(0, 8)}`),
      button('🔁 Reschedule', `rs:${task.id.slice(0, 8)}`),
    ]);
    rows.push([
      button('✏️ Edit', `e:${task.id.slice(0, 8)}`),
      button('🚫 Cancel task', `cancel:${task.id.slice(0, 8)}`),
    ]);
  }

  rows.push([button('⬅ Back', backData)]);

  return keyboard(rows);
}

export function confirmKeyboard({ yesData, noData, cancelData }) {
  return keyboard([
    [button('✅ Yes', yesData), button('❌ No', noData)],
    cancelData ? [button('✖ Cancel', cancelData)] : [],
  ]);
}

export function rescheduleDaysKeyboard({ reference, dates = [] }) {
  const ref = reference.slice(0, 8);
  const rows = [];

  for (let index = 0; index < dates.length; index += 2) {
    const row = [button(formatDateShort(dates[index]), `rsd:${ref}:${dates[index]}`)];
    if (dates[index + 1]) {
      row.push(button(formatDateShort(dates[index + 1]), `rsd:${ref}:${dates[index + 1]}`));
    }
    rows.push(row);
  }

  rows.push([button('⬅ Back to task', `t:${ref}`)]);

  return keyboard(rows);
}

export function slotKeyboard({ reference, date, slots = [], backData }) {
  const ref = reference.slice(0, 8);
  const rows = slots.map((slot) => [
    button(`${slot.start}–${slot.end}`, `rss:${ref}:${date}:${slot.start}`),
  ]);

  rows.push([button('📅 Another day', `rs:${ref}`)]);
  rows.push([button('⬅ Back', backData)]);

  return keyboard(rows);
}

export function rescheduleConfirmKeyboard({ reference, date, time }) {
  const ref = reference.slice(0, 8);

  return keyboard([
    [button('✅ Yes, move it', `rsy:${ref}:${date}:${time}`)],
    [button('⬅ Back to slots', `rsd:${ref}:${date}`)],
  ]);
}

export function addDayKeyboard({ monday }) {
  const days = weekDates(monday);

  return keyboard([
    days.slice(0, 3).map((date) => button(formatDateShort(date), `fd:${date}`)),
    days.slice(3, 6).map((date) => button(formatDateShort(date), `fd:${date}`)),
    [button(formatDateShort(days[6]), `fd:${days[6]}`)],
    [button('📅 Specific date', 'ftl')],
    [button('✖ Cancel', 'fcancel')],
  ]);
}

export function flowTypeKeyboard() {
  return keyboard([
    [button('📌 Fixed', 'ft:fixed'), button('🔁 Flexible', 'ft:flexible')],
    [button('⬅ Back', 'fback'), button('✖ Cancel', 'fcancel')],
  ]);
}

export function flowCategoryKeyboard(categories = []) {
  const rows = [];

  for (let index = 0; index < categories.length; index += 2) {
    const row = [button(categories[index].name, `fc:${categories[index].id.slice(0, 8)}`)];
    const next = categories[index + 1];
    if (next) row.push(button(next.name, `fc:${next.id.slice(0, 8)}`));
    rows.push(row);
  }

  rows.push([button('Skip', 'fc:none')]);
  rows.push([button('⬅ Back', 'fback'), button('✖ Cancel', 'fcancel')]);

  return keyboard(rows);
}

export function flowPriorityKeyboard() {
  return keyboard([
    [button('Low', 'fp:low'), button('Normal', 'fp:normal')],
    [button('High', 'fp:high'), button('Urgent', 'fp:urgent')],
    [button('⬅ Back', 'fback'), button('✖ Cancel', 'fcancel')],
  ]);
}

export function flowDurationKeyboard() {
  return keyboard([
    [button('15 min', 'fu:15'), button('30 min', 'fu:30'), button('45 min', 'fu:45')],
    [button('1 hour', 'fu:60'), button('2 hours', 'fu:120')],
    [button('Custom duration', 'fuc')],
    [button('⬅ Back', 'fback'), button('✖ Cancel', 'fcancel')],
  ]);
}

export function flowTimeKeyboard({ slots = [], blockedReason = null }) {
  const rows = slots.map((slot) => [button(`${slot.start}–${slot.end}`, `ftm:${slot.start}`)]);

  if (rows.length === 0 && blockedReason) {
    rows.push([button('Use another time', 'ftc')]);
  }

  rows.push([
    button('⏰ Other time', 'ftc'),
    button('📥 Leave unscheduled', 'ftn'),
  ]);
  rows.push([button('⬅ Back', 'fback'), button('✖ Cancel', 'fcancel')]);

  return keyboard(rows);
}

export function flowDeadlineKeyboard() {
  return keyboard([
    [button('Yes', 'fdy'), button('No, no deadline', 'fdn')],
    [button('⬅ Back', 'fback'), button('✖ Cancel', 'fcancel')],
  ]);
}

export function flowConfirmKeyboard() {
  return keyboard([
    [button('✅ Yes, save', 'fsave')],
    [button('✏️ Edit', 'fedit'), button('✖ No, cancel', 'fcancel')],
  ]);
}

export function editMenuKeyboard({ reference, categories = [] }) {
  const ref = reference.slice(0, 8);
  const rows = [
    [button('✏️ Title', `et:${ref}`)],
    [
      button('P: Low', `ep:${ref}:low`),
      button('P: Normal', `ep:${ref}:normal`),
      button('P: High', `ep:${ref}:high`),
      button('P: Urgent', `ep:${ref}:urgent`),
    ],
  ];

  const categoryRows = [];
  for (let index = 0; index < categories.length; index += 2) {
    const row = [button(categories[index].name, `ec:${ref}:${categories[index].id.slice(0, 8)}`)];
    const next = categories[index + 1];
    if (next) row.push(button(next.name, `ec:${ref}:${next.id.slice(0, 8)}`));
    categoryRows.push(row);
  }

  rows.push(...categoryRows);
  rows.push([
    button('30 min', `ed:${ref}:30`),
    button('1 hour', `ed:${ref}:60`),
    button('2 hours', `ed:${ref}:120`),
  ]);
  rows.push([button('🔁 Change day/time', `rs:${ref}`)]);
  rows.push([button('⬅ Back to task', `t:${ref}`)]);

  return keyboard(rows);
}

export function pagerKeyboard({ page, pages, prefix }) {
  const rows = [];

  if (pages > 1) {
    rows.push([
      page > 0 ? button('◀ Prev', `${prefix}:${page - 1}`) : null,
      button(`${page + 1}/${pages}`, `${prefix}:${page}`),
      page + 1 < pages ? button('Next ▶', `${prefix}:${page + 1}`) : null,
    ]);
  }

  rows.push([button('⬅ Back to week', 'home')]);
  return keyboard(rows);
}

export function backKeyboard(data = 'home') {
  return keyboard([[button('⬅ Back', data)]]);
}

/* ----------------------------------------------------------- parsing */

const REF = '[0-9a-f]{4,8}';
const DATE = '\\d{4}-\\d{2}-\\d{2}';
const TIME = '(?:[01]\\d|2[0-3]):[0-5]\\d';

const ROUTES = [
  { action: 'home', pattern: /^home$/ },
  { action: 'week', pattern: /^w:(-?[0-9]{1,2})$/ },
  { action: 'day', pattern: new RegExp(`^d:(${DATE})$`) },
  { action: 'today', pattern: /^today$/ },
  { action: 'all', pattern: /^all:([0-9]{1,3})$/ },
  { action: 'unscheduled', pattern: /^u$/ },
  { action: 'review', pattern: /^rev$/ },
  { action: 'add', pattern: /^add$/ },
  { action: 'add', pattern: new RegExp(`^add:(${DATE})$`) },
  { action: 'task', pattern: new RegExp(`^t:(${REF})$`) },
  { action: 'completeAsk', pattern: new RegExp(`^done:(${REF})$`) },
  { action: 'completeYes', pattern: new RegExp(`^doney:(${REF})$`) },
  { action: 'completeNo', pattern: new RegExp(`^donen:(${REF})$`) },
  { action: 'cancelAsk', pattern: new RegExp(`^cancel:(${REF})$`) },
  { action: 'cancelYes', pattern: new RegExp(`^cancely:(${REF})$`) },
  { action: 'cancelNo', pattern: new RegExp(`^canceln:(${REF})$`) },
  { action: 'reschedule', pattern: new RegExp(`^rs:(${REF})$`) },
  { action: 'rescheduleDay', pattern: new RegExp(`^rsd:(${REF}):(${DATE})$`) },
  { action: 'rescheduleSlot', pattern: new RegExp(`^rss:(${REF}):(${DATE}):(${TIME})$`) },
  { action: 'rescheduleYes', pattern: new RegExp(`^rsy:(${REF}):(${DATE}):(${TIME})$`) },
  { action: 'editMenu', pattern: new RegExp(`^e:(${REF})$`) },
  { action: 'editTitle', pattern: new RegExp(`^et:(${REF})$`) },
  { action: 'editPriority', pattern: /^ep:([0-9a-f]{4,8}):(low|normal|high|urgent)$/ },
  { action: 'editCategory', pattern: /^ec:([0-9a-f]{4,8}):([0-9a-f]{4,8}|none)$/ },
  { action: 'editDuration', pattern: /^ed:([0-9a-f]{4,8}):([0-9]{1,3})$/ },
  { action: 'flowDay', pattern: new RegExp(`^fd:(${DATE})$`) },
  { action: 'flowType', pattern: /^ft:(fixed|flexible)$/ },
  { action: 'flowCategory', pattern: /^fc:([0-9a-f]{4,8}|none)$/ },
  { action: 'flowPriority', pattern: /^fp:(low|normal|high|urgent)$/ },
  { action: 'flowDuration', pattern: /^fu:([0-9]{1,3})$/ },
  { action: 'flowCustomDuration', pattern: /^fuc$/ },
  { action: 'flowCustomDate', pattern: /^ftl$/ },
  { action: 'flowTime', pattern: new RegExp(`^ftm:(${TIME})$`) },
  { action: 'flowCustomTime', pattern: /^ftc$/ },
  { action: 'flowUnscheduled', pattern: /^ftn$/ },
  { action: 'flowDeadlineYes', pattern: /^fdy$/ },
  { action: 'flowDeadlineNo', pattern: /^fdn$/ },
  { action: 'flowSave', pattern: /^fsave$/ },
  { action: 'flowEdit', pattern: /^fedit$/ },
  { action: 'flowBack', pattern: /^fback$/ },
  { action: 'flowCancel', pattern: /^fcancel$/ },
];

/**
 * @returns {{ action: string, params: string[] } | null}
 */
export function decodeCallbackData(data) {
  if (typeof data !== 'string' || data.length === 0 || data.length > 64) {
    return null;
  }

  for (const route of ROUTES) {
    const match = data.match(route.pattern);
    if (match) {
      return { action: route.action, params: match.slice(1) };
    }
  }

  return null;
}

export function flowNavKeyboard() {
  return keyboard([
    [button('⬅ Back', 'fback'), button('✖ Cancel', 'fcancel')],
  ]);
}
