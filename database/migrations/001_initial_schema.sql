-- 001_initial_schema.sql
-- Focus Hub initial database structure.
-- Run this through your migration runner once Neon is reachable.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE NOT NULL,
    telegram_chat_id BIGINT,
    display_name TEXT,
    timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    morning_briefing_time TIME NOT NULL DEFAULT '07:00',
    evening_review_time TIME NOT NULL DEFAULT '21:00',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'in_progress', 'completed',
            'skipped', 'cancelled'
        )),
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    scheduling_type TEXT NOT NULL DEFAULT 'flexible'
        CHECK (scheduling_type IN ('fixed', 'flexible')),
    estimated_minutes INTEGER
        CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    deadline TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    recurrence_rule TEXT,
    auto_reschedule BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        scheduled_start IS NULL
        OR scheduled_end IS NULL
        OR scheduled_end > scheduled_start
    )
);

CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    event_type TEXT NOT NULL DEFAULT 'commitment',
    location TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    recurrence_rule TEXT,
    is_fixed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

CREATE TABLE task_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT,
    old_scheduled_start TIMESTAMPTZ,
    new_scheduled_start TIMESTAMPTZ,
    old_scheduled_end TIMESTAMPTZ,
    new_scheduled_end TIMESTAMPTZ,
    reason TEXT,
    actor TEXT NOT NULL DEFAULT 'user'
        CHECK (actor IN ('user', 'system', 'ai')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE energy_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    energy_level TEXT NOT NULL
        CHECK (energy_level IN ('low', 'normal', 'high')),
    optional_note TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reminder_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    reminder_type TEXT NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'processing', 'sent', 'failed', 'cancelled'
        )),
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE daily_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_date DATE NOT NULL,
    completed_count INTEGER NOT NULL DEFAULT 0,
    postponed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    incomplete_count INTEGER NOT NULL DEFAULT 0,
    reflection TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, review_date)
);

CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preference_key TEXT NOT NULL,
    preference_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, preference_key)
);

CREATE INDEX idx_tasks_user_schedule
    ON tasks (user_id, scheduled_start);

CREATE INDEX idx_tasks_user_status
    ON tasks (user_id, status);

CREATE INDEX idx_events_user_start
    ON calendar_events (user_id, starts_at);

CREATE INDEX idx_history_task_created
    ON task_history (task_id, created_at DESC);

CREATE INDEX idx_energy_user_recorded
    ON energy_checkins (user_id, recorded_at DESC);

CREATE INDEX idx_reminders_due
    ON reminder_queue (scheduled_for)
    WHERE status = 'pending';

CREATE INDEX idx_reviews_user_date
    ON daily_reviews (user_id, review_date DESC);
