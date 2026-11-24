import { AppError } from '../middleware/error-handler.js';
import { env } from '../config/env.js';
import { isDuplicateUpdate } from '../bot/update-dedupe.js';
import { commandHandler } from '../bot/commands.js';

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

function displayNameFrom(from = {}) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ') || null;
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

    await handleUpdate(update, userId);

    return res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
}

async function handleUpdate(update, userId) {
  if (update.message) {
    const message = update.message;

    await commandHandler.handleMessage({
      telegramId: userId,
      chatId: message.chat?.id ?? userId,
      displayName: displayNameFrom(message.from),
      text: message.text ?? '',
    });
    return;
  }

  if (update.callback_query) {
    // No interactive buttons exist yet, so there is nothing to act on.
    console.log('[telegram] unhandled callback:', update.callback_query.data);
    return;
  }

  console.log(
    '[telegram] unhandled update type:',
    JSON.stringify(update).slice(0, 200)
  );
}
