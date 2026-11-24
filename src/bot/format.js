const DEFAULT_TIMEZONE = 'Africa/Nairobi';

export function formatTaskRef(task) {
  return task.id.slice(0, 8);
}

export function formatClock(value, timeZone = DEFAULT_TIMEZONE) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatTaskDate(value, timeZone = DEFAULT_TIMEZONE) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function formatTaskLine(task, timeZone = DEFAULT_TIMEZONE, options = {}) {
  const start = formatClock(task.scheduled_start, timeZone);
  const end = formatClock(task.scheduled_end, timeZone);
  const prefix = start ? (end ? `${start}–${end}` : start) : 'unscheduled';
  const done = task.status === 'completed' ? '✅ ' : '';
  const date = options.includeDate
    ? formatTaskDate(task.scheduled_start, timeZone)
    : null;
  const when = date ? `${date} ${prefix}` : prefix;

  return `${done}[${formatTaskRef(task)}] ${when} · ${task.title}`;
}

export function formatTaskList(
  tasks,
  { timeZone = DEFAULT_TIMEZONE, emptyMessage, includeDate = false } = {}
) {
  if (!tasks || tasks.length === 0) {
    return emptyMessage ?? 'Nothing here yet.';
  }

  return tasks
    .map((task) => formatTaskLine(task, timeZone, { includeDate }))
    .join('\n');
}
