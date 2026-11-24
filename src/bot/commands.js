import { env } from '../config/env.js';
import { sendMessage } from './telegram.js';
import { createTaskService } from '../services/task.service.js';
import { createUserRepository } from '../repositories/user.repository.js';
import { formatTaskList } from './format.js';
import { AppError } from '../middleware/error-handler.js';

export const HELP_TEXT = [
  '📋 Focus Hub commands',
  '',
  '/start   - Register and get a welcome message',
  '/today   - Today\'s scheduled tasks',
  '/pending - Tasks still open',
  '/add     - Create a task, e.g. /add Revise chapter 4',
  '/done    - Complete a task, e.g. /done 1a2b3c4d',
  '/cancel  - Cancel a task, e.g. /cancel 1a2b3c4d',
  '/help    - Show this message',
  '',
  'Task references come from /pending or /today.',
].join('\n');

const UNKNOWN_COMMAND = 'I do not know that command yet. Send /help to see what works.';
const NOT_A_COMMAND = 'I only understand commands for now. Send /help to see them.';
const NOT_REGISTERED = 'Send /start first so I know who you are.';

function parseCommand(text) {
  const [rawCommand, ...rest] = text.trim().split(/\s+/);
  const command = rawCommand.replace(/@\w+$/, '').toLowerCase();
  return { command, args: rest.join(' ').trim() };
}

export function createCommandHandler({
  send = sendMessage,
  tasks = createTaskService(),
  users = createUserRepository(),
} = {}) {
  async function reply(chatId, text) {
    await send(chatId, text);
  }

  async function requireUser(telegramId, chatId) {
    const user = await users.findByTelegramId(telegramId);

    if (!user) {
      await reply(chatId, NOT_REGISTERED);
      return null;
    }

    return user;
  }

  async function handleAdd(user, chatId, args) {
    const task = await tasks.createTask(user, { title: args });
    await reply(
      chatId,
      `Added "[${task.id.slice(0, 8)}] ${task.title}". Track it with /pending.`
    );
  }

  async function handleDone(user, chatId, args) {
    if (!args) {
      await reply(chatId, 'Send /done with a task reference, e.g. /done 1a2b3c4d');
      return;
    }

    const task = await tasks.completeTask(user, args);
    await reply(chatId, `✅ Completed "${task.title}".`);
  }

  async function handleCancel(user, chatId, args) {
    if (!args) {
      await reply(chatId, 'Send /cancel with a task reference, e.g. /cancel 1a2b3c4d');
      return;
    }

    const task = await tasks.cancelTask(user, args);
    await reply(chatId, `🚫 Cancelled "${task.title}".`);
  }

  return {
    /**
     * @param {{ telegramId: number, chatId: number, displayName?: string, text: string }} message
     */
    async handleMessage({ telegramId, chatId, displayName, text }) {
      if (typeof text !== 'string' || text.trim() === '') {
        await reply(chatId, NOT_A_COMMAND);
        return;
      }

      const { command, args } = parseCommand(text);

      if (command === '/start') {
        const user = await users.upsertFromTelegram({
          telegramId,
          chatId,
          displayName,
          timezone: env.defaultTimezone,
        });

        const name = user.display_name ? `, ${user.display_name}` : '';
        await reply(
          chatId,
          [
            `👋 Focus Hub ready${name}.`,
            '',
            'I can track your tasks and show your day.',
            '',
            'Use /help to see the commands.',
          ].join('\n')
        );
        return;
      }

      if (command === '/help') {
        await reply(chatId, HELP_TEXT);
        return;
      }

      if (!command.startsWith('/')) {
        await reply(chatId, NOT_A_COMMAND);
        return;
      }

      try {
        const user = await requireUser(telegramId, chatId);
        if (!user) return;

        switch (command) {
          case '/today': {
            const list = await tasks.listTodayTasks(user);
            await reply(
              chatId,
              `📅 Today\n\n${formatTaskList(list, {
                timeZone: user.timezone,
                emptyMessage: 'Nothing scheduled for today.',
              })}`
            );
            return;
          }

          case '/pending': {
            const list = await tasks.listPendingTasks(user);
            await reply(
              chatId,
              `🗂 Pending\n\n${formatTaskList(list, {
                timeZone: user.timezone,
                emptyMessage: 'No open tasks.',
                includeDate: true,
              })}`
            );
            return;
          }

          case '/add':
            await handleAdd(user, chatId, args);
            return;

          case '/done':
            await handleDone(user, chatId, args);
            return;

          case '/cancel':
            await handleCancel(user, chatId, args);
            return;

          default:
            await reply(chatId, UNKNOWN_COMMAND);
        }
      } catch (error) {
        if (error instanceof AppError) {
          await reply(chatId, `⚠️ ${error.message}`);
          return;
        }
        throw error;
      }
    },
  };
}

export const commandHandler = createCommandHandler();
