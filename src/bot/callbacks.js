/**
 * Callback query processing.
 *
 * Routing, authorisation and error handling live in the planner bot; this
 * module is the single entry point for `callback_query` updates.
 *
 * Invariants:
 * - every callback is acknowledged with answerCallbackQuery
 * - callback data is validated against a fixed route table
 * - task and session lookups are scoped to the Telegram user
 * - repeated presses cannot create duplicate tasks or state changes
 */

import { plannerBot } from './planner.js';

export function createCallbackHandler({ planner = plannerBot } = {}) {
  return {
    async handleCallbackQuery(callback) {
      await planner.handleCallback({
        telegramId: callback.from?.id,
        chatId: callback.message?.chat?.id,
        messageId: callback.message?.message_id ?? null,
        callbackId: callback.id,
        data: callback.data,
      });
    },

    /**
     * @returns {Promise<boolean>} whether the update was handled
     */
    async handleCallbackUpdate(update) {
      const callback = update?.callback_query;

      if (!callback) {
        return false;
      }

      await this.handleCallbackQuery(callback);
      return true;
    },
  };
}

export const callbackHandler = createCallbackHandler();

export async function handleCallbackUpdate(update) {
  return callbackHandler.handleCallbackUpdate(update);
}
