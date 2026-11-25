-- 002_planner_sessions.sql
-- Durable state for multi-step interactive flows (task creation and editing).
--
-- Telegram webhook handlers run in a short-lived, restartable process, so an
-- unfinished guided conversation must live in PostgreSQL rather than memory.

CREATE TABLE planner_sessions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    flow TEXT NOT NULL,
    step TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_planner_sessions_expiry
    ON planner_sessions (expires_at);
