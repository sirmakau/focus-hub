import { sendMessage } from './telegram.js';

export async function handleStart({ userId, chatId, update }) {
  await sendMessage(chatId, [
    '👋 Focus Hub loaded.',
    '',
    'I can help you manage your day, tasks and commitments.',
    '',
    'Use /help to see available commands.',
  ].join('\n'));
}

export async function handleHelp({ userId, chatId, update }) {
  await sendMessage(chatId, [
    '📋 *Focus Hub commands*',
    '',
    '/start   - Register or initialise',
    '/today   - Today\'s schedule',
    '/tomorrow- Tomorrow\'s schedule',
    '/week    - Weekly timetable',
    '/add     - Create a task',
    '/pending - Incomplete tasks',
    '/done    - Complete a task',
    '/progress- Progress summary',
    '/energy  - Report current energy',
    '/review  - Start daily review',
    '/help    - Show this message',
    '',
    'Natural-language requests will be added later.',
  ].join('\n'), { parse_mode: 'Markdown' });
}

export async function handleToday({ userId, chatId, update }) {
  await sendMessage(chatId, '📅 Today\'s schedule is not implemented yet.');
}
