/**
 * Bounded, in-memory duplicate-update suppression.
 *
 * Telegram retries an update when a webhook response is slow or non-2xx.
 * Because Focus Hub runs as a single Render instance (WEB_CONCURRENCY=1),
 * remembering recently seen update ids in memory is enough to stop the most
 * common duplicate deliveries. This is intentionally not durable: the
 * reminder queue uses an idempotency key in the database for anything that
 * must survive a restart.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

const seen = new Map();

function prune(now) {
  for (const [id, seenAt] of seen) {
    if (now - seenAt < TTL_MS) break;
    seen.delete(id);
  }

  while (seen.size > MAX_ENTRIES) {
    const oldest = seen.keys().next();
    if (oldest.done) break;
    seen.delete(oldest.value);
  }
}

/**
 * @param {number | string | undefined | null} updateId
 * @returns {boolean} true when this update id was already processed recently.
 */
export function isDuplicateUpdate(updateId) {
  if (updateId === undefined || updateId === null) {
    return false;
  }

  const now = Date.now();
  const seenAt = seen.get(updateId);

  if (seenAt !== undefined && now - seenAt < TTL_MS) {
    return true;
  }

  seen.set(updateId, now);
  prune(now);
  return false;
}

export function resetUpdateDedupe() {
  seen.clear();
}
