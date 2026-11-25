import { env } from '../config/env.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

function buildUrl(method) {
  return `${TELEGRAM_API_BASE}${env.telegram.botToken}/${method}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function telegramRequest(method, payload, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(buildUrl(method), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) || {};

      if (!response.ok) {
        const errorDescription =
          data.description || `telegram request failed: ${response.status}`;

        if (response.status === 404 || response.status === 400) {
          throw new Error(errorDescription);
        }

        console.warn(
          `[telegram] attempt ${attempt}/${maxAttempts} failed for ${method}:`,
          errorDescription
        );

        if (attempt === maxAttempts) {
          throw new Error(errorDescription);
        }

        await sleep(baseDelayMs * attempt);
        continue;
      }

      return data;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      console.warn(
        `[telegram] attempt ${attempt}/${maxAttempts} exception for ${method}:`,
        error.message
      );
      await sleep(baseDelayMs * attempt);
    }
  }

  throw new Error(`telegramRequest exhausted attempts for ${method}`);
}

export async function sendMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...options,
  };

  return telegramRequest('sendMessage', payload);
}

export async function editMessageText(chatId, messageId, text, options = {}) {
  return telegramRequest('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    ...options,
  });
}

export async function answerCallbackQuery(callbackQueryId, options = {}) {
  return telegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...options,
  });
}
