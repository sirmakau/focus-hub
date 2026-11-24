import { AppError } from '../middleware/error-handler.js';
import { env } from '../config/env.js';
import { isDuplicateUpdate } from '../bot/update-dedupe.js';
import {
  handleStart,
  handleHelp,
  handleToday,
} from '../bot/commands.js';

const TELEGRAM_UPDATE_TYPES = new Set([
  'message',
  'edited_message',
  'callback_query',
  'inline_query',
  'channel_post',
  'edited_channel_post',
]);

function getUserIdFromUpdate(update) {
  if (update.message?.from) return update.message.from.id;
  if (update.edited_message?.from) return update.edited_message.from.id;
  if (update.callback_query?.from) return update.callback_query.from.id;
  if (update.inline_query?.from) return update.inline_query.from.id;
  if (update.channel_post?.from) return update.channel_post.from.id;
  if (update.edited_channel_post?.from) return update.edited_channel_post.from.id;
  return null;
}

export async function handleTelegramUpdate(req, res, next) {
  try {
    const update = req.body;
    if (!update || typeof update !== 'object') {
      throw new AppError('Invalid update payload', {
        statusCode: 400,
        code: 'INVALID_UPDATE',
      });
    }

    // Telegram retries updates that do not get a 2xx response, so a
    // duplicate delivery must be acknowledged rather than reprocessed.
    if (isDuplicateUpdate(update.update_id)) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    const updateType = Object.keys(update).find((key) =>
      TELEGRAM_UPDATE_TYPES.has(key)
    );

    if (!updateType) {
      return res.status(200).json({ received: true });
    }

    const userId = getUserIdFromUpdate(update);
    if (userId === null) {
      return res.status(200).json({ received: true });
    }

    if (!env.telegram.authorizedUserIds.includes(userId)) {
      // Acknowledge and drop unauthorised updates. Returning an error would
      // make Telegram retry the same update for hours.
      console.warn(
        `[telegram] unauthorised user attempted access: ${userId}`
      );
      return res.status(200).json({ received: true, ignored: true });
    }

    await handleUpdate(update);

    return res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
}

async function handleUpdate(update) {
  if (update.message?.text) {
    const text = update.message.text.trim();
    const userId = update.message.from.id;
    const chatId = update.message.chat.id;

    if (text === '/start') {
      await handleStart({ userId, chatId, update });
      return;
    }

    if (text === '/help') {
      await handleHelp({ userId, chatId, update });
      return;
    }

    if (text === '/today') {
      await handleToday({ userId, chatId, update });
      return;
    }
  }

  if (update.callback_query) {
    await handleCallbackQuery(update);
    return;
  }

  console.log('[telegram] unhandled update type:', JSON.stringify(update).slice(0, 200));
}

async function handleCallbackQuery(update) {
  const callback = update.callback_query;
  const userId = callback.from.id;

  if (!env.telegram.authorizedUserIds.includes(userId)) {
    console.warn(`[telegram] unauthorised callback user: ${userId}`);
    return;
  }

  // TODO: implement callback handling with idempotency once buttons exist.
  console.log('[telegram] unhandled callback:', callback.data);
}
