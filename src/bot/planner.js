import { sendMessage, editMessageText, answerCallbackQuery } from './telegram.js';
import { createPlanService } from '../services/plan.service.js';
import { createFlowService } from '../services/flow.service.js';
import { createUserRepository } from '../repositories/user.repository.js';
import { formatClock } from './format.js';
import { AppError } from '../middleware/error-handler.js';
import {
  addDayKeyboard,
  backKeyboard,
  confirmKeyboard,
  dayKeyboard,
  decodeCallbackData,
  editMenuKeyboard,
  eventDeleteConfirmKeyboard,
  eventEditMenuKeyboard,
  eventKeyboard,
  flowCategoryKeyboard,
  flowConfirmKeyboard,
  flowDeadlineKeyboard,
  flowDurationKeyboard,
  flowNavKeyboard,
  flowPriorityKeyboard,
  flowTimeKeyboard,
  flowTypeKeyboard,
  pagerKeyboard,
  rescheduleConfirmKeyboard,
  rescheduleDaysKeyboard,
  scheduleConfirmKeyboard,
  scheduleDateKeyboard,
  scheduleEndKeyboard,
  scheduleStartKeyboard,
  slotKeyboard,
  taskKeyboard,
  weekKeyboard,
} from './keyboards.js';
import {
  addDays,
  formatDateLong,
  formatDateShort,
  formatWeekday,
  parseUserDate,
  todayInZone,
  zonedDateOf,
} from '../utils/dates.js';

const STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

const PRIORITY_LABELS = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

const TYPE_LABELS = { fixed: 'Fixed', flexible: 'Flexible' };

const WEEK_OFFSET_LIMIT = 8;
const RESCHEDULE_DAYS = 7;
const DAY_TASK_LIMIT = 12;

const FLOW_STEP_FOR = {
  flowDay: ['day'],
  flowCustomDate: ['day'],
  flowType: ['type'],
  flowCategory: ['category'],
  flowPriority: ['priority'],
  flowDuration: ['duration'],
  flowCustomDuration: ['duration'],
  flowTime: ['time'],
  flowCustomTime: ['time'],
  flowUnscheduled: ['time'],
  flowDeadlineYes: ['deadline'],
  flowDeadlineNo: ['deadline'],
  flowSave: ['confirm'],
  flowEdit: ['confirm'],
  editPriority: ['edit_menu'],
  editCategory: ['edit_menu'],
  editDuration: ['edit_menu'],
};

function tzOf(user) {
  return user.timezone || 'Africa/Nairobi';
}

/** Build an Undo callback from the latest history row that kept a snapshot. */
function buttonOrNull(text, data) {
  return data ? { text, callback_data: data } : null;
}

function undoDataFor(history, kind, reference) {
  const entry = (history ?? []).find((row) => row.id && row.details?.previous);
  if (!entry) return null;

  const prefix = kind === 'event' ? 'undoe' : 'undo';
  return `${prefix}:${reference}:${String(entry.id).slice(0, 8)}`;
}

function timeRange(task, timeZone) {
  const start = formatClock(task.scheduled_start, timeZone);
  const end = formatClock(task.scheduled_end, timeZone);
  if (!start) return 'unscheduled';
  return end ? `${start}–${end}` : start;
}

function durationLabel(minutes) {
  if (!minutes) return null;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} min`;
}

function energyLine(energy) {
  if (!energy) return '⚡ No energy check-in yet — I will not guess how you feel.';
  return `⚡ Energy: ${energy.energy_level} (your last check-in)`;
}

function normalizeTimeInput(text) {
  const match = String(text).trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeDurationInput(text) {
  const value = String(text).trim().toLowerCase();
  const match = value.match(/(\d+)/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (/h|hour/.test(value)) return amount * 60;
  return amount;
}

export function createPlannerBot({
  send = sendMessage,
  edit = editMessageText,
  answer = answerCallbackQuery,
  plans = createPlanService(),
  flows = createFlowService(),
  users = createUserRepository(),
  now = () => new Date(),
} = {}) {
  const savingUsers = new Set();

  async function safeAnswer(callbackId, options = {}) {
    try {
      await answer(callbackId, options);
    } catch (error) {
      console.warn('[planner] answerCallbackQuery failed:', error.message);
    }
  }

  async function present({ chatId, messageId, text, keyboard }) {
    const options = keyboard ? { reply_markup: keyboard } : {};

    if (messageId) {
      try {
        await edit(chatId, messageId, text, options);
        return;
      } catch (error) {
        if (/not modified/i.test(error.message ?? '')) return;
        console.warn('[planner] edit failed, sending a new message:', error.message);
      }
    }

    await send(chatId, text, options);
  }

  /* ------------------------------------------------------------- views */

  function dashboardView(week) {
    const lines = week.days.map((day) => {
      const marker = day.isToday ? ' · today' : '';
      const count =
        day.count === 0 ? 'no tasks' : `${day.count} task${day.count === 1 ? '' : 's'}`;
      return `${formatDateLong(day.date)} · ${count}${marker}`;
    });

    const title =
      week.offset === 0
        ? '🗓 Focus Hub — this week'
        : `🗓 Focus Hub — week of ${formatDateShort(week.monday)}`;

    return {
      text: [
        title,
        `${formatDateShort(week.monday)} – ${formatDateShort(addDays(week.monday, 6))}`,
        '',
        ...lines,
        '',
        'Tap a day to open it.',
      ].join('\n'),
      keyboard: weekKeyboard(week),
    };
  }

  function dayView(day) {
    const timeZone = day.timeZone;
    const lines = [`📅 ${day.longLabel}`, ''];

    lines.push('🕒 Fixed commitments');
    if (day.events.length === 0) {
      lines.push('No fixed commitments.');
    } else {
      for (const event of day.events) {
        const start = formatClock(event.starts_at, timeZone);
        const end = formatClock(event.ends_at, timeZone);
        lines.push(`${start}–${end} · ${event.title}`);
      }
    }

    const visibleTasks = day.tasks.slice(0, DAY_TASK_LIMIT);

    lines.push('', '🗂 Scheduled tasks');
    if (day.tasks.length === 0) {
      lines.push('Nothing scheduled yet.');
    } else {
      for (const task of visibleTasks) {
        const status = STATUS_LABELS[task.status] ?? task.status;
        lines.push(`${timeRange(task, timeZone)} · ${task.title} · ${status}`);
      }

      if (day.tasks.length > visibleTasks.length) {
        lines.push(
          `…and ${day.tasks.length - visibleTasks.length} more. Open All tasks to see them.`
        );
      }
    }

    lines.push('', `📥 Unscheduled tasks: ${day.unscheduled.length}`);
    lines.push(energyLine(day.energy));

    return {
      text: lines.join('\n'),
      keyboard: dayKeyboard({
        date: day.date,
        tasks: visibleTasks,
        events: day.events,
      }),
    };
  }

  function taskCardView({ task, category, history }, timeZone, prefix = null) {
    const lines = [];

    if (prefix) {
      lines.push(prefix, '');
    }

    lines.push(`Task: ${task.title}`);
    lines.push(`Time: ${timeRange(task, timeZone)}`);

    if (task.estimated_minutes) {
      lines.push(`Duration: ${durationLabel(task.estimated_minutes)}`);
    }

    lines.push(`Category: ${category?.name ?? 'Uncategorised'}`);
    lines.push(`Status: ${STATUS_LABELS[task.status] ?? task.status}`);
    lines.push(`Priority: ${PRIORITY_LABELS[task.priority] ?? task.priority}`);
    lines.push(`Type: ${TYPE_LABELS[task.scheduling_type] ?? task.scheduling_type}`);

    if (task.deadline) {
      lines.push(`Deadline: ${formatClock(task.deadline, timeZone)} ${formatDateShort(
        zonedDateOf(task.deadline, timeZone)
      )}`);
    }

    if (history && history.length > 0) {
      const last = history[0];
      lines.push('', `Last change: ${last.event_type} by ${last.actor}`);
    }

    const backData = task.scheduled_start
      ? `d:${zonedDateOf(task.scheduled_start, timeZone)}`
      : 'u';
    const reference = task.id.slice(0, 8);

    return {
      text: lines.join('\n'),
      keyboard: taskKeyboard({
        task,
        backData,
        undoData: undoDataFor(history, 'task', reference),
      }),
    };
  }

  function eventCardView({ event, history }, timeZone, prefix = null) {
    const lines = [];

    if (prefix) lines.push(prefix, '');

    lines.push(`📌 Commitment: ${event.title}`);
    lines.push(
      `Time: ${formatDateShort(zonedDateOf(event.starts_at, timeZone))} ${formatClock(
        event.starts_at,
        timeZone
      )}–${formatClock(event.ends_at, timeZone)}`
    );

    const minutes = Math.round(
      (new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()) / 60000
    );
    lines.push(`Duration: ${durationLabel(minutes)}`);
    lines.push(`Type: ${event.is_fixed ? 'Fixed' : 'Flexible'}`);

    if (event.is_fixed) {
      lines.push(
        'Fixed means automatic scheduling will never move it. You can still edit or move it yourself.'
      );
    }

    if (event.description) {
      lines.push('', event.description);
    }

    if (history && history.length > 0) {
      const last = history[0];
      lines.push('', `Last change: ${last.event_type} by ${last.actor}`);
    }

    const reference = event.id.slice(0, 8);

    return {
      text: lines.join('\n'),
      keyboard: eventKeyboard({
        event,
        backData: `d:${zonedDateOf(event.starts_at, timeZone)}`,
        undoData: undoDataFor(history, 'event', reference),
      }),
    };
  }

  function allTasksView(result) {
    const lines = [
      `🗂 All open tasks (${result.total})`,
      '',
    ];

    if (result.tasks.length === 0) {
      lines.push('No open tasks. Add one from the week view.');
    } else {
      for (const task of result.tasks) {
        lines.push(`${timeRange(task, result.timeZone)} · ${task.title}`);
      }
    }

    const pager = pagerKeyboard({
      page: result.page,
      pages: result.pages,
      prefix: 'all',
    });

    return {
      text: lines.join('\n'),
      keyboard: {
        inline_keyboard: [
          ...result.tasks.map((task) => [
            { text: task.title.slice(0, 48), callback_data: `t:${task.id.slice(0, 8)}` },
          ]),
          ...pager.inline_keyboard,
        ],
      },
    };
  }

  function unscheduledView(result) {
    const lines = ['📥 Unscheduled tasks', ''];

    if (result.tasks.length === 0) {
      lines.push('Nothing waiting to be scheduled.');
    } else {
      for (const task of result.tasks) {
        lines.push(`• ${task.title}`);
      }
    }

    return {
      text: lines.join('\n'),
      keyboard: {
        inline_keyboard: [
          ...result.tasks.map((task) => [
            { text: task.title.slice(0, 48), callback_data: `t:${task.id.slice(0, 8)}` },
          ]),
          [{ text: '⬅ Back to week', callback_data: 'home' }],
        ],
      },
    };
  }

  function reviewView(result) {
    const { week, totals } = result;
    const lines = [
      `📊 Weekly review — ${formatDateShort(week.monday)} – ${formatDateShort(addDays(week.monday, 6))}`,
      '',
      `Completed: ${totals.completed} of ${totals.total} scheduled`,
      `Still open: ${totals.open}`,
      `Unscheduled: ${result.unscheduledCount}`,
      '',
    ];

    for (const day of result.days) {
      lines.push(
        `${formatWeekday(day.date)} ${formatDateShort(day.date).split(' ').slice(1).join(' ')} · ${day.completed}/${day.total} done`
      );
    }

    return { text: lines.join('\n'), keyboard: backKeyboard('home') };
  }

  /* -------------------------------------------------------------- flow */

  async function flowView(user, session) {
    const payload = session.payload ?? {};
    const timeZone = tzOf(user);

    switch (session.step) {
      case 'day': {
        const week = await plans.week(user, { offset: payload.weekOffset ?? 0 });
        return {
          text: [
            '➕ New task — which day?',
            '',
            'Pick a day, or send me a specific date.',
          ].join('\n'),
          keyboard: addDayKeyboard({ monday: week.monday }),
        };
      }

      case 'title':
        return {
          text: [
            '➕ New task — what is the task?',
            payload.title ? `\nCurrent: ${payload.title}` : '',
            '',
            'Send the name as a message.',
          ]
            .filter((line) => line !== '')
            .join('\n'),
          keyboard: flowNavKeyboard(),
        };

      case 'custom_date':
        return {
          text: '📅 Send the date as DD/MM or YYYY-MM-DD.',
          keyboard: flowNavKeyboard(),
        };

      case 'type':
        return {
          text: '📌 Is it fixed or flexible?\n\nFixed commitments are never moved automatically.',
          keyboard: flowTypeKeyboard(),
        };

      case 'category': {
        const categories = await plans.listCategories(user);
        return {
          text: '🏷 What category?',
          keyboard: flowCategoryKeyboard(categories),
        };
      }

      case 'priority':
        return {
          text: '🎯 What priority?',
          keyboard: flowPriorityKeyboard(),
        };

      case 'duration':
        return {
          text: '⏱ How long will it take?',
          keyboard: flowDurationKeyboard(),
        };

      case 'custom_duration':
        return {
          text: '⏱ Send the duration in minutes (for example 90).',
          keyboard: flowNavKeyboard(),
        };

      case 'time': {
        const durationMinutes = payload.durationMinutes ?? 30;
        const slotInfo = await plans.slots(user, {
          date: payload.date,
          durationMinutes,
        });

        const lines = [
          '🕐 When should it happen?',
          '',
          `📅 ${formatDateLong(payload.date)}`,
          `⏱ ${durationLabel(durationMinutes)}`,
          energyLine(slotInfo.energy),
          '',
        ];

        if (slotInfo.slots.length === 0) {
          lines.push(slotInfo.blockedReason ?? 'No free slot fits.');
        } else {
          lines.push('Suggested slots:');
        }

        return {
          text: lines.join('\n'),
          keyboard: flowTimeKeyboard({
            slots: slotInfo.slots,
            blockedReason: slotInfo.blockedReason,
          }),
        };
      }

      case 'custom_time':
        return {
          text: '⏰ Send a 24-hour time, for example 09:30.',
          keyboard: flowNavKeyboard(),
        };

      case 'deadline':
        return {
          text: '📌 Does it have a deadline?',
          keyboard: flowDeadlineKeyboard(),
        };

      case 'custom_deadline':
        return {
          text: '📌 Send the deadline date as DD/MM or YYYY-MM-DD.',
          keyboard: flowNavKeyboard(),
        };

      case 'confirm': {
        const lines = [
          'Should I save this task?',
          '',
          `📝 ${payload.title}`,
          `📅 ${formatDateLong(payload.date)}`,
          `🕐 ${payload.time ? `${payload.time} (${durationLabel(payload.durationMinutes ?? 30)})` : 'Unscheduled'}`,
          `🏷 ${payload.categoryName ?? 'Uncategorised'}`,
          `📌 ${TYPE_LABELS[payload.schedulingType ?? 'flexible']}`,
          `🎯 ${PRIORITY_LABELS[payload.priority ?? 'normal']}`,
          `⏳ Deadline: ${payload.deadlineDate ?? 'none'}`,
        ];

        return { text: lines.join('\n'), keyboard: flowConfirmKeyboard() };
      }

      case 'edit_menu':
      case 'edit_title':
      case 'edit_description':
      case 'edit_duration': {
        if (payload.kind === 'event') {
          if (session.step === 'edit_title') {
            return {
              text: '✏️ Send the new commitment name.',
              keyboard: backKeyboard(`evm:${payload.taskRef}`),
            };
          }
          if (session.step === 'edit_description') {
            return {
              text: '📝 Send the new description, or "none" to clear it.',
              keyboard: backKeyboard(`evm:${payload.taskRef}`),
            };
          }
          return {
            text: `✏️ Edit commitment\n\nChoose a field. Changes save immediately.`,
            keyboard: eventEditMenuKeyboard({ reference: payload.taskRef }),
          };
        }

        return editMenuView(user, payload.taskRef, {
          promptingTitle: session.step === 'edit_title',
          promptingDescription: session.step === 'edit_description',
          promptingDuration: session.step === 'edit_duration',
        });
      }

      case 'schedule_date': {
        const dates = Array.from({ length: 7 }, (_, index) =>
          addDays(todayInZone(timeZone, now()), index)
        );
        return {
          text: [
            `🕐 ${payload.title ?? 'Item'} — which date?`,
            '',
            'Pick a day, or send a date as DD/MM or YYYY-MM-DD.',
          ].join('\n'),
          keyboard: scheduleDateKeyboard({ reference: payload.ref, dates }),
        };
      }

      case 'schedule_start':
        return {
          text: [
            'What should the new start time be?',
            '',
            `📅 ${formatDateLong(payload.date)}`,
            payload.start ? `Current start: ${payload.start}` : null,
            '',
            'Send a 24-hour time, for example 20:30.',
          ]
            .filter((line) => line !== null)
            .join('\n'),
          keyboard: scheduleStartKeyboard({
            reference: payload.ref,
            start: payload.start,
          }),
        };

      case 'schedule_end':
        return {
          text: [
            'What should the new end time be?',
            '',
            `📅 ${formatDateLong(payload.date)}`,
            payload.start ? `Start: ${payload.start}` : null,
            payload.end ? `Proposed end: ${payload.end}` : null,
            '',
            'Send a 24-hour time, for example 21:00.',
          ]
            .filter((line) => line !== null)
            .join('\n'),
          keyboard: scheduleEndKeyboard({ end: payload.end }),
        };

      case 'schedule_confirm': {
        const conflict = payload.conflict;
        const lines = [
          'Confirm this change?',
          '',
          `Current: ${payload.originalDate ? formatDateShort(payload.originalDate) : 'unscheduled'} ${payload.originalStart ?? '—'}–${payload.originalEnd ?? '—'}`,
          `New: ${formatDateShort(payload.date)} ${payload.start}–${payload.end}`,
        ];

        if (payload.isFixed) {
          lines.push(
            '',
            '📌 This is a manual change to a fixed item. Automatic scheduling will still never move it.'
          );
        }

        if (conflict) {
          const label = conflict.kind === 'event' ? 'commitment' : 'task';
          lines.push(
            '',
            `⚠️ This overlaps "${conflict.title}" (${label}, ${formatClock(
              conflict.startsAt,
              timeZone
            )}–${formatClock(conflict.endsAt, timeZone)}).`,
            'Nothing else will be moved. Saving anyway double-books that time.'
          );
        }

        return {
          text: lines.join('\n'),
          keyboard: scheduleConfirmKeyboard({ hasConflict: Boolean(conflict) }),
        };
      }

      default:
        return {
          text: 'That form is no longer available. Tap Add task to start again.',
          keyboard: backKeyboard('home'),
        };
    }
  }

  async function editMenuView(
    user,
    reference,
    { promptingTitle = false, promptingDescription = false, promptingDuration = false } = {}
  ) {
    const categories = await plans.listCategories(user);

    if (promptingTitle) {
      return {
        text: '✏️ Send the new task name.',
        keyboard: backKeyboard(`e:${reference}`),
      };
    }

    if (promptingDescription) {
      return {
        text: '📝 Send a new description, or "none" to clear it.',
        keyboard: backKeyboard(`e:${reference}`),
      };
    }

    if (promptingDuration) {
      return {
        text: '⏱ Send the duration in minutes (1–480). The start time stays the same.',
        keyboard: backKeyboard(`e:${reference}`),
      };
    }

    return {
      text: `✏️ Edit task\n\nChoose a field. Changes save immediately.`,
      keyboard: editMenuKeyboard({ reference, categories }),
    };
  }

  async function renderFlow(user, chatId, session, messageId) {
    const view = await flowView(user, session);
    await present({ chatId, messageId, ...view });
  }

  /* ------------------------------------------------------------- views */

  async function showDashboard(user, chatId, messageId, offset = 0) {
    const safeOffset = Math.max(-WEEK_OFFSET_LIMIT, Math.min(WEEK_OFFSET_LIMIT, offset));
    const week = await plans.week(user, { offset: safeOffset });
    await present({ chatId, messageId, ...dashboardView(week) });
  }

  async function showDay(user, chatId, messageId, date) {
    const day = await plans.day(user, date);
    await present({ chatId, messageId, ...dayView(day) });
  }

  async function showTask(user, chatId, messageId, reference, prefix = null) {
    const card = await plans.taskCard(user, reference);
    await present({
      chatId,
      messageId,
      ...taskCardView(card, tzOf(user), prefix),
    });
  }

  async function showEvent(user, chatId, messageId, reference, prefix = null) {
    const card = await plans.eventCard(user, reference);
    await present({
      chatId,
      messageId,
      ...eventCardView(card, tzOf(user), prefix),
    });
  }

  async function showScheduledItem(user, chatId, messageId, result, prefix) {
    if (result.kind === 'event') {
      await showEvent(user, chatId, messageId, result.item.id.slice(0, 8), prefix);
      return;
    }

    await showTask(user, chatId, messageId, result.item.id.slice(0, 8), prefix);
  }

  async function openDashboard({ user, chatId }) {
    await showDashboard(user, chatId, null, 0);
  }

  async function startAddFlow(user, chatId, messageId, date = null) {
    const session = await flows.startAdd(user, { date });
    await renderFlow(user, chatId, session, messageId);
  }

  /* --------------------------------------------------------- callbacks */

  async function handleFlowCallback(user, chatId, messageId, action, params) {
    const state = await flows.getState(user);

    if (!state) {
      throw new AppError('That form has expired. Tap Add task to start again.', {
        statusCode: 410,
        code: 'FLOW_EXPIRED',
      });
    }

    const allowed = FLOW_STEP_FOR[action];
    if (allowed && !allowed.includes(state.step)) {
      throw new AppError('That question is no longer open.', {
        statusCode: 409,
        code: 'FLOW_STEP_MISMATCH',
      });
    }

    let session = null;

    switch (action) {
      case 'flowDay':
        session = await flows.setDay(user, params[0]);
        break;
      case 'flowCustomDate':
        session = await flows.requestCustomDate(user);
        break;
      case 'flowType':
        session = await flows.setType(user, params[0]);
        break;
      case 'flowCategory': {
        const code = params[0];
        let category = null;
        if (code !== 'none') {
          const categories = await plans.listCategories(user);
          category = categories.find((item) => item.id.slice(0, 8) === code) ?? null;
          if (!category) {
            throw new AppError('That category no longer exists.', {
              statusCode: 404,
              code: 'CATEGORY_NOT_FOUND',
            });
          }
        }
        session = await flows.setCategory(user, category);
        break;
      }
      case 'flowPriority':
        session = await flows.setPriority(user, params[0]);
        break;
      case 'flowDuration':
        session = await flows.setDuration(user, Number(params[0]));
        break;
      case 'flowCustomDuration':
        session = await flows.requestCustomDuration(user);
        break;
      case 'flowTime':
        session = await flows.setTime(user, params[0]);
        break;
      case 'flowCustomTime':
        session = await flows.requestCustomTime(user);
        break;
      case 'flowUnscheduled':
        session = await flows.setTime(user, null);
        break;
      case 'flowDeadlineYes':
        session = await flows.requestCustomDeadline(user);
        break;
      case 'flowDeadlineNo':
        session = await flows.setDeadline(user, null);
        break;
      case 'flowEdit':
        session = await flows.reopen(user);
        break;
      case 'flowBack':
        session = await flows.back(user);
        break;
      case 'flowCancel':
        await flows.clear(user);
        await showDashboard(user, chatId, messageId, 0);
        return 'Cancelled';
      case 'flowSave': {
        if (savingUsers.has(user.id)) {
          throw new AppError('That task is already being saved.', {
            statusCode: 409,
            code: 'FLOW_SAVING',
          });
        }

        savingUsers.add(user.id);
        try {
          const result = await flows.save(user);
          await flows.clear(user);
          await showTask(
            user,
            chatId,
            messageId,
            result.task.id.slice(0, 8),
            result.duplicate
              ? '✅ That task was already saved.'
              : `✅ Saved "${result.task.title}".`
          );
          return result.duplicate ? 'Already saved' : 'Saved';
        } finally {
          savingUsers.delete(user.id);
        }
      }
      default:
        throw new AppError('That button is not available.', {
          statusCode: 400,
          code: 'CALLBACK_UNKNOWN',
        });
    }

    await renderFlow(user, chatId, session, messageId);
    return null;
  }

  async function handleCallback({ telegramId, chatId, callbackId, messageId, data }) {
    const user = await users.findByTelegramId(telegramId);

    if (!user) {
      await safeAnswer(callbackId, {
        text: 'Send /start first so I know who you are.',
        show_alert: true,
      });
      return;
    }

    const parsed = decodeCallbackData(data);

    if (!parsed) {
      await safeAnswer(callbackId, {
        text: 'This menu is out of date. Send /start for the main menu.',
        show_alert: true,
      });
      return;
    }

    const { action, params } = parsed;
    let toast = null;

    try {
      const applyActions = new Set(['editPriority', 'editCategory', 'editType']);

      if (action.startsWith('flow') || applyActions.has(action)) {
        if (applyActions.has(action)) {
          const state = await flows.getState(user);
          if (!state) {
            throw new AppError('That form has expired. Open the task again.', {
              statusCode: 410,
              code: 'FLOW_EXPIRED',
            });
          }
          if (state.step !== 'edit_menu') {
            throw new AppError('That question is no longer open.', {
              statusCode: 409,
              code: 'FLOW_STEP_MISMATCH',
            });
          }

          let value;
          if (action === 'editPriority' || action === 'editType') {
            value = params[1];
          } else if (action === 'editCategory') {
            const code = params[1];
            if (code === 'none') {
              value = null;
            } else {
              const categories = await plans.listCategories(user);
              value = categories.find((item) => item.id.slice(0, 8) === code);
              if (!value) {
                throw new AppError('That category no longer exists.', {
                  statusCode: 404,
                  code: 'CATEGORY_NOT_FOUND',
                });
              }
            }
          } else {
            value = Number(params[1]);
          }

          const field =
            action === 'editPriority'
              ? 'priority'
              : action === 'editCategory'
                ? 'category'
                : action === 'editType'
                  ? 'type'
                  : 'duration';

          const result = await flows.applyEdit(user, field, value);

          if (result.kind === 'event') {
            await showEvent(user, chatId, messageId, result.item.id.slice(0, 8), '✅ Updated.');
          } else {
            await showTask(user, chatId, messageId, result.item.id.slice(0, 8), '✅ Updated.');
          }
          toast = 'Updated';
        } else {
          toast = await handleFlowCallback(user, chatId, messageId, action, params);
        }
      } else {
        switch (action) {
          case 'home':
            await showDashboard(user, chatId, messageId, 0);
            break;
          case 'week':
            await showDashboard(user, chatId, messageId, Number(params[0]));
            break;
          case 'day':
            await showDay(user, chatId, messageId, params[0]);
            break;
          case 'today':
            await showDay(user, chatId, messageId, todayInZone(tzOf(user), now()));
            break;
          case 'all':
            await present({
              chatId,
              messageId,
              ...allTasksView(await plans.allTasks(user, Number(params[0]))),
            });
            break;
          case 'unscheduled':
            await present({
              chatId,
              messageId,
              ...unscheduledView(await plans.unscheduled(user)),
            });
            break;
          case 'review':
            await present({
              chatId,
              messageId,
              ...reviewView(await plans.review(user)),
            });
            break;
          case 'add':
            await startAddFlow(user, chatId, messageId, params[0] ?? null);
            break;
          case 'task':
            await showTask(user, chatId, messageId, params[0]);
            break;
          case 'event':
            await showEvent(user, chatId, messageId, params[0]);
            break;
          case 'eventMenu': {
            const card = await plans.eventCard(user, params[0]);
            const session = await flows.startEdit(user, card.event, { kind: 'event' });
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'eventTitle':
            await flows.requestEditTitle(user);
            await present({
              chatId,
              messageId,
              text: '✏️ Send the new commitment name.',
              keyboard: backKeyboard(`evm:${params[0]}`),
            });
            break;
          case 'eventDescription':
            await flows.requestEditDescription(user);
            await present({
              chatId,
              messageId,
              text: '📝 Send the new description, or "none" to clear it.',
              keyboard: backKeyboard(`evm:${params[0]}`),
            });
            break;
          case 'eventFixed': {
            let state = await flows.getState(user);
            if (!state || state.step !== 'edit_menu' || state.payload.kind !== 'event') {
              // The card offers the toggle directly, without opening the menu.
              const card = await plans.eventCard(user, params[0]);
              state = await flows.startEdit(user, card.event, { kind: 'event' });
            }

            const result = await flows.applyEdit(user, 'type', params[1]);
            await showEvent(
              user,
              chatId,
              messageId,
              result.item.id.slice(0, 8),
              `✅ Marked as ${params[1]}.`
            );
            toast = 'Updated';
            break;
          }
          case 'eventSchedule': {
            const card = await plans.eventCard(user, params[0]);
            const session = await flows.startSchedule(user, {
              kind: 'event',
              item: card.event,
            });
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'eventDeleteAsk': {
            const card = await plans.eventCard(user, params[0]);
            await present({
              chatId,
              messageId,
              text: [
                'Delete this commitment?',
                '',
                `📌 ${card.event.title}`,
                `🕐 ${formatDateShort(
                  zonedDateOf(card.event.starts_at, tzOf(user))
                )} ${formatClock(card.event.starts_at, tzOf(user))}`,
                '',
                'It will be removed from your planner. You can undo this.',
              ].join('\n'),
              keyboard: eventDeleteConfirmKeyboard({ reference: params[0] }),
            });
            break;
          }
          case 'eventDeleteYes': {
            const result = await plans.deleteEvent(user, params[0]);
            toast = '🗑 Deleted';
            await present({
              chatId,
              messageId,
              text: `🗑 Deleted "${result.event.title}". You can undo this.`,
              keyboard: {
                inline_keyboard: [
                  ...(result.undoRef
                    ? [
                        [
                          buttonOrNull(
                            '↩ Undo delete',
                            `undoe:${result.event.id.slice(0, 8)}:${result.undoRef}`
                          ),
                        ],
                      ]
                    : []),
                  [{ text: '⬅ Back to week', callback_data: 'home' }],
                ],
              },
            });
            break;
          }
          case 'eventDeleteNo':
            await showEvent(user, chatId, messageId, params[0]);
            break;
          case 'undoTask': {
            const [reference, undoRef] = params;
            const result = await plans.undoChange(user, { kind: 'task', reference, undoRef });
            toast = '↩ Undone';
            await showTask(user, chatId, messageId, result.item.id.slice(0, 8), '↩ Change undone.');
            break;
          }
          case 'undoEvent': {
            const [reference, undoRef] = params;
            const result = await plans.undoChange(user, { kind: 'event', reference, undoRef });
            toast = '↩ Undone';
            await showEvent(user, chatId, messageId, result.item.id.slice(0, 8), '↩ Change undone.');
            break;
          }
          case 'taskSchedule': {
            const card = await plans.taskCard(user, params[0]);
            const session = await flows.startSchedule(user, { item: card.task });
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'taskStartTime': {
            const state = await flows.getState(user);
            const reference = state?.payload?.ref;
            if (!reference) {
              throw new AppError('That change has expired. Open the item again.', {
                statusCode: 410,
                code: 'FLOW_EXPIRED',
              });
            }
            const session = await flows.requestScheduleStart(user);
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'taskEndTime': {
            const state = await flows.getState(user);
            if (!state?.payload?.ref) {
              throw new AppError('That change has expired. Open the item again.', {
                statusCode: 410,
                code: 'FLOW_EXPIRED',
              });
            }
            const session = await flows.requestScheduleEnd(user);
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'scheduleDate': {
            const session = await flows.setScheduleDate(user, params[1]);
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'scheduleDatePrompt': {
            await flows.requestScheduleDate(user);
            const state = await flows.getState(user);
            await renderFlow(user, chatId, state, messageId);
            break;
          }
          case 'scheduleKeepStart': {
            const session = await flows.keepScheduleStart(user);
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'scheduleKeepEnd': {
            const session = await flows.keepScheduleEnd(user);
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'scheduleSave':
          case 'scheduleForceSave': {
            const acceptConflict = action === 'scheduleForceSave';
            const result = await flows.saveSchedule(user, { acceptConflict });
            toast = '✅ Saved';
            await showScheduledItem(
              user,
              chatId,
              messageId,
              result,
              result.acceptedConflict
                ? '⚠️ Saved with a conflict. Nothing else was moved.'
                : '✅ Time updated.'
            );
            break;
          }
          case 'scheduleCancel': {
            const state = await flows.getState(user);
            await flows.clear(user);
            if (state?.payload?.kind === 'event') {
              await showEvent(user, chatId, messageId, state.payload.ref, 'Cancelled.');
            } else if (state?.payload?.ref) {
              await showTask(user, chatId, messageId, state.payload.ref, 'Cancelled.');
            } else {
              await showDashboard(user, chatId, messageId, 0);
            }
            break;
          }
          case 'completeAsk': {
            const card = await plans.taskCard(user, params[0]);
            await present({
              chatId,
              messageId,
              text: [
                'Did you complete this task?',
                '',
                `📝 ${card.task.title}`,
                `🕐 ${timeRange(card.task, tzOf(user))}`,
              ].join('\n'),
              keyboard: confirmKeyboard({
                yesData: `doney:${params[0]}`,
                noData: `donen:${params[0]}`,
              }),
            });
            break;
          }
          case 'completeYes': {
            const task = await plans.completeTask(user, params[0]);
            toast = '✅ Completed';
            await showTask(user, chatId, messageId, task.id.slice(0, 8), '✅ Completed. Well done.');
            break;
          }
          case 'completeNo':
          case 'cancelNo':
          case 'rescheduleCancel':
            await showTask(user, chatId, messageId, params[0]);
            break;
          case 'cancelAsk': {
            const card = await plans.taskCard(user, params[0]);
            await present({
              chatId,
              messageId,
              text: [
                'Are you sure you want to cancel this task?',
                '',
                `📝 ${card.task.title}`,
              ].join('\n'),
              keyboard: confirmKeyboard({
                yesData: `cancely:${params[0]}`,
                noData: `canceln:${params[0]}`,
              }),
            });
            break;
          }
          case 'cancelYes': {
            const task = await plans.cancelTask(user, params[0]);
            toast = '🚫 Cancelled';
            await showTask(user, chatId, messageId, task.id.slice(0, 8), '🚫 Task cancelled.');
            break;
          }
          case 'reschedule': {
            const dates = Array.from({ length: RESCHEDULE_DAYS }, (_, index) =>
              addDays(todayInZone(tzOf(user), now()), index + 1)
            );
            await present({
              chatId,
              messageId,
              text: '🔁 Pick a new day for this task.',
              keyboard: rescheduleDaysKeyboard({
                reference: params[0],
                dates,
              }),
            });
            break;
          }
          case 'rescheduleDay': {
            const [reference, date] = params;
            const card = await plans.taskCard(user, reference);
            const duration = card.task.estimated_minutes ?? 30;
            const slotInfo = await plans.slots(user, {
              date,
              durationMinutes: duration,
              excludeTaskId: card.task.id,
            });

            const lines = [
              `🔁 Move "${card.task.title}"`,
              `📅 ${formatDateLong(date)}`,
              `⏱ ${durationLabel(duration)}`,
              energyLine(slotInfo.energy),
              '',
            ];

            if (slotInfo.slots.length === 0) {
              lines.push(slotInfo.blockedReason ?? 'No free slot on that day. Pick another.');
            } else {
              lines.push('Choose a slot:');
            }

            await present({
              chatId,
              messageId,
              text: lines.join('\n'),
              keyboard: slotKeyboard({
                reference,
                date,
                slots: slotInfo.slots,
                backData: `rs:${reference}`,
              }),
            });
            break;
          }
          case 'rescheduleSlot': {
            const [reference, date, time] = params;
            const card = await plans.taskCard(user, reference);

            await present({
              chatId,
              messageId,
              text: [
                `Move "${card.task.title}"?`,
                '',
                `📅 ${formatDateLong(date)}`,
                `🕐 ${time}`,
              ].join('\n'),
              keyboard: rescheduleConfirmKeyboard({ reference, date, time }),
            });
            break;
          }
          case 'rescheduleYes': {
            const [reference, date, time] = params;
            const task = await plans.reschedule(user, { reference, date, time });
            toast = '✅ Rescheduled';
            await showTask(
              user,
              chatId,
              messageId,
              task.id.slice(0, 8),
              `✅ Moved to ${formatDateShort(date)} ${time}.`
            );
            break;
          }
          case 'editMenu': {
            const card = await plans.taskCard(user, params[0]);
            const session = await flows.startEdit(user, card.task);
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          case 'editTitle':
            await flows.requestEditTitle(user);
            await present({
              chatId,
              messageId,
              text: '✏️ Send the new task name.',
              keyboard: backKeyboard(`e:${params[0]}`),
            });
            break;
          case 'editDescription':
            await flows.requestEditDescription(user);
            await present({
              chatId,
              messageId,
              text: '📝 Send a new description, or "none" to clear it.',
              keyboard: backKeyboard(`e:${params[0]}`),
            });
            break;
          case 'editCustomDuration':
            await flows.requestEditDuration(user);
            await present({
              chatId,
              messageId,
              text: '⏱ Send the duration in minutes (1–480). The start time stays the same.',
              keyboard: backKeyboard(`e:${params[0]}`),
            });
            break;
          case 'editDuration': {
            const card = await plans.taskCard(user, params[0]);
            const session = await flows.startDurationChange(user, {
              item: card.task,
              minutes: Number(params[1]),
            });
            await renderFlow(user, chatId, session, messageId);
            break;
          }
          default:
            throw new AppError('That button is not available.', {
              statusCode: 400,
              code: 'CALLBACK_UNKNOWN',
            });
        }
      }
    } catch (error) {
      if (error instanceof AppError) {
        await safeAnswer(callbackId, { text: `⚠️ ${error.message}`, show_alert: true });
        return;
      }

      console.error('[planner] callback failed:', error);
      await safeAnswer(callbackId, {
        text: 'Something went wrong. Please try again.',
        show_alert: true,
      });
      return;
    }

    await safeAnswer(callbackId, toast ? { text: toast } : {});
  }

  /* ------------------------------------------------------------- text */

  async function handleText({ telegramId, chatId, text }) {
    const user = await users.findByTelegramId(telegramId);
    if (!user) return false;

    const session = await flows.getState(user);
    if (!session) return false;

    try {
      let nextSession = null;

      switch (session.step) {
        case 'title':
          nextSession = await flows.setTitle(user, text);
          break;

        case 'custom_date': {
          const date = parseUserDate(text, { timeZone: tzOf(user) });
          if (!date) {
            throw new AppError('Use DD/MM or YYYY-MM-DD, for example 28/11.', {
              statusCode: 400,
              code: 'DATE_INVALID',
            });
          }
          nextSession = await flows.setDay(user, date);
          break;
        }

        case 'custom_duration': {
          const minutes = normalizeDurationInput(text);
          if (!minutes) {
            throw new AppError('Send the duration in minutes, for example 90.', {
              statusCode: 400,
              code: 'DURATION_INVALID',
            });
          }
          nextSession = await flows.setDuration(user, minutes);
          break;
        }

        case 'custom_time': {
          const time = normalizeTimeInput(text);
          if (!time) {
            throw new AppError('Use 24-hour time like 09:30.', {
              statusCode: 400,
              code: 'TIME_INVALID',
            });
          }
          nextSession = await flows.setTime(user, time);
          break;
        }

        case 'custom_deadline': {
          const date = parseUserDate(text, { timeZone: tzOf(user) });
          if (!date) {
            throw new AppError('Use DD/MM or YYYY-MM-DD for the deadline.', {
              statusCode: 400,
              code: 'DATE_INVALID',
            });
          }
          nextSession = await flows.setDeadline(user, date);
          break;
        }

        case 'edit_title': {
          const result = await flows.applyEdit(user, 'title', text);
          await showScheduledItem(user, chatId, null, result, '✅ Updated.');
          return true;
        }

        case 'edit_description': {
          const result = await flows.applyEdit(
            user,
            'description',
            /^(none|clear|skip)$/i.test(text.trim()) ? '' : text
          );
          await showScheduledItem(user, chatId, null, result, '✅ Updated.');
          return true;
        }

        case 'edit_duration': {
          const minutes = normalizeDurationInput(text);
          if (!minutes) {
            throw new AppError('Send the duration in minutes, for example 90.', {
              statusCode: 400,
              code: 'DURATION_INVALID',
            });
          }
          const state = await flows.getState(user);
          const card = await plans.taskCard(user, state.payload.taskRef);
          nextSession = await flows.startDurationChange(user, {
            item: card.task,
            minutes,
          });
          break;
        }

        case 'schedule_date': {
          const date = parseUserDate(text, { timeZone: tzOf(user) });
          if (!date) {
            throw new AppError('Use DD/MM or YYYY-MM-DD for the new date.', {
              statusCode: 400,
              code: 'DATE_INVALID',
            });
          }
          nextSession = await flows.setScheduleDate(user, date);
          break;
        }

        case 'schedule_start': {
          const time = normalizeTimeInput(text);
          if (!time) {
            throw new AppError('Use 24-hour time like 20:30.', {
              statusCode: 400,
              code: 'TIME_INVALID',
            });
          }
          nextSession = await flows.setScheduleStart(user, time);
          break;
        }

        case 'schedule_end': {
          const time = normalizeTimeInput(text);
          if (!time) {
            throw new AppError('Use 24-hour time like 21:00.', {
              statusCode: 400,
              code: 'TIME_INVALID',
            });
          }
          nextSession = await flows.setScheduleEnd(user, time);
          break;
        }

        default:
          await send(
            chatId,
            'Please use the buttons above, or tap Cancel to leave this form.'
          );
          return true;
      }

      await renderFlow(user, chatId, nextSession, null);
      return true;
    } catch (error) {
      if (error instanceof AppError) {
        await send(chatId, `⚠️ ${error.message}`);
        return true;
      }

      console.error('[planner] text step failed:', error);
      await send(chatId, 'Something went wrong. Please try again.');
      return true;
    }
  }

  return {
    openDashboard,
    startAddFlow,
    handleCallback,
    handleText,
    showDashboard,
    showDay,
    showTask,
  };
}

export const plannerBot = createPlannerBot();
