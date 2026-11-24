/**
 * Callback query processing.
 *
 * In the initial release most interactive buttons are not yet defined,
 * so this module is a placeholder that documents the intended contract:
 *
 * - Every callback handler must be idempotent.
 * - Repeated button presses must not create duplicate changes.
 * - Updates must be acknowledged with answerCallbackQuery.
 * - Database changes must verify task/user ownership.
 */

export async function handleCallbackUpdate(update) {
  const callback = update.callback_query;

  if (!callback) {
    return;
  }

  // TODO: implement once interactive task buttons exist.
  console.log('[callbacks] unhandled callback data:', callback.data);
}
