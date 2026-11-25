# Focus Hub 2.0 — Progress

Last updated: 2026-11-25
Branch: `main`
Production: `https://focus-hub-5swv.onrender.com` (Render + Neon PostgreSQL)

A running record of what is built, what is verified, and what is still missing.
The product specification lives in `../focushub.txt`.

---

## 1. Status at a glance

| Area | State |
| --- | --- |
| Express app, env validation, error handling | Done |
| Neon PostgreSQL schema + tracked migrations | Done |
| Telegram webhook (routing, secret, de-duplication) | Done and live |
| Health check with DB reachability | Done and live |
| Task workflow: `/start`, `/help`, `/today`, `/pending`, `/add`, `/done`, `/cancel` | Done |
| Task persistence + `task_history` | Done |
| Button-driven weekly planner (dashboard, day pages, task cards) | Done |
| Guided task creation + editing (`planner_sessions`) | Done |
| Reschedule with slot suggestions and conflict checks | Done |
| Manual task and commitment editing (exact times, conflicts, undo) | Done |
| Calendar event history (`calendar_event_history`) | Code done; migration 003 pending |
| Weekly review | Done |
| Skip / postpone | Not implemented |
| Reminder engine | Not implemented (skeleton only) |
| Scheduling engine (slots, buffers, energy) | Done for user-initiated scheduling |
| Daily reviews | Not implemented (skeleton only) |
| AI / natural language | Not implemented |
| Test suite | 117 tests, passing |
| `002_planner_sessions.sql` | Run locally; not verified against the hosted database |
| `003_manual_edits.sql` applied | **Not applied yet** |

---

## 2. What works

### Deployment and infrastructure
- `render.yaml` Blueprint: Node runtime, `npm install`, `npm start`, health check at `/health`, secrets marked `sync: false`.
- `GET /health` always answers `200` so Render does not restart the service on a Neon cold start. The body reports the real state:

```json
{ "status": "ok", "database": "up", "environment": "production", "timestamp": "..." }
```

  Unreachable database gives `"status": "degraded"`, `"database": "down"`.
- Connection pool `connectionTimeoutMillis` is `15000`, raised from `5000` because Neon cold starts regularly exceeded 5 s.

### Telegram webhook
- Endpoint: `POST /telegram/webhook` (router mounted at `/telegram`, handler declared as `/webhook`).
- Secret accepted from `X-Telegram-Bot-Api-Secret-Token`, a query parameter, or a header, compared in constant time.
- Missing or wrong secret: `401`.
- Malformed JSON: `400 INVALID_JSON` (previously surfaced as `500`).
- Oversized bodies: `413`.
- Duplicate update ids are dropped in memory and answered `200 { "duplicate": true }`, which stops Telegram retrying.
- Unauthorized Telegram users are logged and answered `200` — a `403` makes Telegram retry for hours.
- Unknown update types are acknowledged with `200`.

### Bot commands
| Command | Behaviour |
| --- | --- |
| `/start` | Upserts the Telegram user and sends a welcome message |
| `/help` | Lists only the commands that exist |
| `/today` | Today's tasks in the user's timezone |
| `/pending` | Open tasks across all days, with their date |
| `/add <title>` | Creates an unscheduled task (title ≤ 200 chars) |
| `/done <ref>` | Completes a task by its 8-character reference |
| `/cancel <ref>` | Cancels a task by its 8-character reference |

Task references are the first 8 characters of the UUID and are shown in `/today` and `/pending` output. Every state change writes a `task_history` row inside the same transaction as the task update.

### Data layer
- `database/migrations/001_initial_schema.sql` holds the schema: 9 tables, all indexes present.
- `database/migrate.js` tracks applied migrations in `schema_migrations` and bootstraps that table for a database that already has the schema.
- Verified read-only against Neon: PostgreSQL 18.7, tables and indexes as expected.
- Row counts at the last audit: users 1, tasks 10, calendar_events 10, categories 9.

### Tests
```bash
npm test    # node --test tests/*.test.js
```
94 tests covering webhook auth and errors, update de-duplication, the task service,
formatting, the command dispatcher, timezone/week maths, callback-data validation,
slot suggestions, day and week views, rescheduling and conflict rules, fixed-commitment
protection, and the guided creation flow. They run against fake repositories and a
deliberately unreachable `DATABASE_URL`, so no production data is touched.

### Interactive planner

- `/start` opens the weekly dashboard (Monday–Sunday, per-day counts, week navigation).
- A day page lists fixed commitments, scheduled tasks, unscheduled count and the latest
  energy check-in.
- Task cards offer Complete, Reschedule, Edit and Cancel; Complete and Cancel ask for
  confirmation, and rescheduling shows suggested slots for a chosen day.
- Add task walks nine questions, one at a time, stored in `planner_sessions` so a
  restart does not lose an unfinished form. Save is explicit and idempotent.
- Scheduling refuses overlaps, past times, deadlines, sleep hours (22:00–06:00) and
  days already at 8 scheduled hours. Every change writes `task_history` with old and
  new schedule, reason and actor.
- Slash commands still work for backward compatibility.

---

## 3. Verification performed

Live, non-destructive checks against production (repeated across several rounds):

- `GET /health` → `200`
- `POST /telegram/webhook` without the secret → `401`
- malformed JSON → `400 INVALID_JSON`
- unauthorized user → `200`
- unknown update type → `200`
- repeated update id → `200 { "duplicate": true }`
- `getWebhookInfo` → the Render URL, `pending_update_count: 0`, no `last_error`

Real database, read path only:

- `/today` listed 5 tasks (07:00–21:15 Nairobi time)
- `/pending` listed 10 tasks with dates
- `/help`, `/done` usage text and the unknown-command reply were correct

Migration statements were validated inside a transaction that was rolled back, so the Neon schema was not altered.

---

## 4. Known limitations

- **Migration `002_planner_sessions.sql` has not been applied to Neon.** The planner UI depends on that table; until it is applied, button flows will fail on save/step updates while slash commands keep working. Apply with `npm run db:migrate` after approval.
- **The planner has not been exercised against a live Telegram chat or real database rows.** It is covered by unit tests with fake repositories. Do a deliberate live pass.
- **`/add`, `/done` and `/cancel` have not been run against production data.** They are covered by unit tests with a fake repository, but a live run would create and modify real rows. Do this deliberately.
- **Deployment of the task-workflow commit is not confirmed live.** The distinguishing signal is the `/help` text: the new build lists `/add`, `/done`, `/cancel`; the old one listed `/tomorrow` and `/review`.
- **`npm run db:migrate` has not been run against Neon.** It creates the `schema_migrations` table, which is a schema change that needs approval.
- **`npm run type-check` exits 1 with 145 pre-existing errors** and missing `@types/node`. The source is plain JavaScript; this is informational and was left unsuppressed rather than hidden.
- **Render service settings and environment variables cannot be inspected from the repository**; changes there are manual.
- `pg` prints an SSL `sslmode` warning on connect. Harmless, but noisy.

---

### Manual editing (latest increment)
- Tasks and calendar commitments have separate cards and edit menus; fixed items are fully editable by their owner, only protected from automation.
- Exact date and `HH:MM` start/end editing with end-later-than-start validation and `Africa/Nairobi` wall-clock conversion.
- Conflicts name the exact item and time; the user can go back or explicitly **Save anyway**, and no other item is ever moved.
- Every change records previous/new values, actor and timestamp; tasks use `task_history.details`, commitments use `calendar_event_history`.
- Undo restores the previous snapshot and adds a new history row instead of deleting the audit trail; commitment deletion is a soft delete.

## 5. Not implemented

These exist as files or table definitions only — the bot does not use them yet:

- **Reminders** — the queue table exists; `src/workers/reminder.worker.js` is a skeleton. No delivery, retries, or inline buttons.
- **Unattended rescheduling** — only the guarded `autoReschedule` path exists; nothing calls it on a timer yet.
- **Recurring events** — `calendar_events.recurrence_rule` is stored but not expanded, so only single events appear in a day.
- **Full history display** — the last history entry and an Undo action are shown on item cards; the full timeline is not browseable.
- **Daily reviews** — weekly review is read-only and computed live; `src/services/review.service.js` is still a skeleton.
- **AI / natural language** — no LLM integration; guided flows and slash commands only.
- **Skip and postpone** — `skipped` and `postponed` are already valid `HISTORY_EVENT_TYPES`, but no command reaches them.

---

## 6. Next steps

1. Confirm the new build is live by sending `/help` to the bot.
2. Exercise `/start`, `/today`, `/pending`, `/add`, `/done`, `/cancel` end to end with a real chat.
3. Implement skip and postpone, writing `skipped` / `postponed` history entries.
4. Apply `003_manual_edits.sql` wherever the bot runs, then exercise manual editing in a live chat.
5. Build the reminder worker: queue polling, delivery, retries, interactive buttons.
6. Expand recurring calendar events and unattended (explainable) rescheduling.
7. Daily reviews and reflections.
8. Natural-language layer over the existing flows.

## 7. Principles

- Reliability before intelligence.
- Protect important commitments.
- Automate only within explicitly defined boundaries.
- Never lose task history.
- Respect the user's energy and available time.
- Make every automated decision explainable and reversible.

---

## Commit history

| Commit | Summary |
| --- | --- |
| `d92648f` | Initial Focus Hub 2.0 backend commit |
| `f2e8819` | Improve README with commands, webhook setup, and env table |
| `f9c0e17` | Add Render Blueprint for the Focus Hub web service |
| `6f7f4d0` | Fix Telegram webhook route path and secret header |
| `cf40352` | Harden webhook handling and add the first test suite |
| `0c22a6e` | Implement the core task workflow behind the bot |
