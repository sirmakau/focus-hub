-- 003_manual_edits.sql
-- Manual task/commitment editing: change details, calendar event audit trail
-- and reversible deletion of calendar events.

-- Task edits need to remember the previous values of non-schedule fields so an
-- edit can be undone without deleting the audit row.
ALTER TABLE task_history
    ADD COLUMN IF NOT EXISTS details JSONB;

-- Calendar events need their own history table; task_history is tied to tasks
-- and cannot honestly record commitment changes.
CREATE TABLE IF NOT EXISTS calendar_event_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES calendar_events(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    old_title TEXT,
    new_title TEXT,
    old_description TEXT,
    new_description TEXT,
    old_starts_at TIMESTAMPTZ,
    new_starts_at TIMESTAMPTZ,
    old_ends_at TIMESTAMPTZ,
    new_ends_at TIMESTAMPTZ,
    old_is_fixed BOOLEAN,
    new_is_fixed BOOLEAN,
    old_deleted_at TIMESTAMPTZ,
    new_deleted_at TIMESTAMPTZ,
    details JSONB,
    reason TEXT,
    actor TEXT NOT NULL DEFAULT 'user'
        CHECK (actor IN ('user', 'system', 'ai')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_history_event_created
    ON calendar_event_history (event_id, created_at DESC);

-- Deleting a commitment is reversible only if the row survives, so deletion is
-- recorded as a timestamp instead of a hard DELETE.
ALTER TABLE calendar_events
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_events_user_start_active
    ON calendar_events (user_id, starts_at)
    WHERE deleted_at IS NULL;
