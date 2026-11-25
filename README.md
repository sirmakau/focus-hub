# Focus Hub

Focus Hub is a personal productivity and life-management assistant.

**Primary interface:** Telegram
**Backend:** Node.js + Express
**Database:** Neon PostgreSQL
**Language:** JavaScript (ES modules)
**Default timezone:** Africa/Nairobi

This repository is the backend for Focus Hub 2.0, built according to the product specification in `../focushub.txt`.

## Quick start

```bash
cd focus-hub
cp .env.example .env
npm install
```

Edit `.env` with real values, at minimum:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `AUTHORIZED_TELEGRAM_USER_IDS`
- `DATABASE_URL`

Optional:
- `APP_URL` and `PORT`
- `NODE_ENV`
- `DEFAULT_TIMEZONE`

The app will not start if `TELEGRAM_BOT_TOKEN` or `DATABASE_URL` are missing.

## Commands

### Run the server

```bash
npm start
# or, for auto-restart on file changes:
npm run dev
```

The server listens on `PORT` (default `3000`) and exposes:

- `GET /health`
- `POST /telegram/webhook`

### Database

Run pending migrations against Neon:

```bash
npm run db:migrate
```

Seed the database if a seed script is provided:

```bash
npm run db:seed
```

Migrations live in `database/migrations/`. The initial schema is intended to be run only after Neon is reachable and `.env` is configured.

`002_planner_sessions.sql` adds the `planner_sessions` table that stores unfinished
guided forms. The interactive planner needs it; slash commands work without it.

### Health check

A standalone check that boots the app and verifies basic reachability, including the database if configured:

```bash
npm run health
# or directly:
node src/health-check.js
```

Healthy response example:

```json
{
  "status": "ok",
  "database": "up",
  "environment": "development",
  "timestamp": "2026-02-02T10:00:00.000Z"
}
```

If the database cannot be reached the endpoint still answers `200` (so Render does not restart the service) but reports `"status": "degraded"` and `"database": "down"`.

### Tests

```bash
npm test
```

Runs the Node.js built-in test runner against `tests/`. No extra dependencies are required.

### Type checking

Optional strictness check using the project `tsconfig.json`:

```bash
npm run type-check
```

This is currently informational. The source files are plain JavaScript; stricter typing would require `@types/*` packages and/or JSDoc annotations.

## Bot interface

The primary interface is a button-driven weekly planner. Text commands still work for
backward compatibility, but they are no longer the expected way to use the bot.

### Slash commands (backward compatible)

| Command | Behaviour |
| --- | --- |
| `/start` | Registers the user and opens the weekly dashboard |
| `/help` | Lists the commands that actually exist |
| `/today` | Today's scheduled tasks in the user's timezone |
| `/pending` | Open tasks across days, with their date |
| `/add <title>` | Creates a flexible, unscheduled task |
| `/done <ref>` | Completes a task by its short reference |
| `/cancel <ref>` | Cancels a task by its short reference |

Task references (first 8 characters of the UUID) are shown in `/today` and `/pending` output.

### Weekly dashboard

`/start` shows the current week, Monday to Sunday, with the task count for each day.
Each day is a button. The dashboard also offers **Add task**, **Today**, **All tasks**,
**Unscheduled**, **Weekly review**, and previous/next/this-week navigation. Weeks are
calculated in the user's timezone (`Africa/Nairobi` by default).

Opening a day shows the full date, fixed calendar commitments, scheduled tasks in
chronological order, the number of unscheduled tasks, and the latest energy check-in.
Each task opens a card with **Complete**, **Reschedule**, **Edit** and **Cancel**.

### Guided task creation

**Add task** asks one question at a time: day, title (typed), fixed/flexible, category,
priority, duration, time, deadline, then a confirmation summary. Slots are suggested
from the day's real free time. Every step has Back and Cancel. Answers are stored in
`planner_sessions`, so a server restart does not destroy an unfinished form.

### Scheduling rules

- fixed commitments are never moved automatically
- flexible tasks may be rescheduled
- overlapping tasks and calendar events are refused
- sleep is protected: tasks stay between 06:00 and 22:00
- deadlines are enforced
- a day is capped at 8 hours of scheduled work
- the latest energy check-in changes slot suggestions; with no check-in, nothing is assumed
- every schedule change writes `task_history` with old/new times, reason and actor

### Testing the planner on Telegram

1. Apply the new migration once (see Database).
2. Deploy, or run `npm run dev` with a public webhook URL.
3. Send `/start` — the weekly dashboard should appear.
4. Tap a day, then a task; try Complete, Reschedule, Edit and Cancel.
5. Tap **Add task** and walk the whole flow, including Back, Cancel and the final
   confirmation. Press **Yes, save** twice to confirm only one task is created.
6. Verify times and dates are shown in Nairobi time.

## Webhook setup

Telegram sends updates to:

```bash
POST /telegram/webhook
```

To receive updates, register the webhook with Telegram once the app is publicly reachable:

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook
  ?url=<APP_URL>/telegram/webhook
  &secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Useful reminders:
- `APP_URL` must be the public base URL, including scheme and port if not 443.
- The webhook secret in `.env` must match the `secret_token` used when registering the webhook.
- `AUTHORIZED_TELEGRAM_USER_IDS` is a comma-separated list of allowed Telegram user IDs.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | No | Default `development` |
| `PORT` | No | Default `3000` |
| `APP_URL` | No | Default `http://localhost:<PORT>` |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot API token |
| `TELEGRAM_WEBHOOK_SECRET` | Recommended | Webhook secret token |
| `AUTHORIZED_TELEGRAM_USER_IDS` | Yes | Comma-separated Telegram user IDs |
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `DEFAULT_TIMEZONE` | No | Default `Africa/Nairobi` |

`.env` is git-ignored and must never be committed.

## Project structure

```text
focus-hub/
├── src/
│   ├── config/
│   │   ├── env.js
│   │   └── database.js
│   ├── bot/
│   │   ├── telegram.js          # Bot API transport (send, edit, answerCallbackQuery)
│   │   ├── commands.js          # slash commands + text hand-off to flows
│   │   ├── callbacks.js         # callback_query entry point
│   │   ├── keyboards.js         # inline keyboards + callback-data validation
│   │   ├── planner.js           # dashboard, day pages, task cards, flow rendering
│   │   └── format.js
│   ├── routes/
│   │   └── webhook.routes.js
│   ├── controllers/
│   │   └── telegram.controller.js
│   ├── services/
│   │   ├── task.service.js
│   │   ├── plan.service.js      # week/day views, rescheduling, review
│   │   ├── flow.service.js      # guided add/edit state machine
│   │   ├── session.service.js   # durable active-form storage
│   │   ├── schedule.service.js  # slots, conflicts, rest and load rules
│   │   ├── energy.service.js
│   │   ├── reminder.service.js
│   │   └── review.service.js
│   ├── repositories/
│   │   ├── task.repository.js
│   │   ├── calendar.repository.js
│   │   ├── category.repository.js
│   │   ├── energy.repository.js
│   │   ├── planner-session.repository.js
│   │   ├── schedule.repository.js
│   │   └── reminder.repository.js
│   ├── utils/
│   │   └── dates.js             # timezone-safe dates, weeks and wall times
│   ├── workers/
│   │   └── reminder.worker.js
│   ├── middleware/
│   │   ├── error-handler.js
│   │   └── webhook-auth.js
│   ├── app.js
│   ├── server.js
│   └── health-check.js
├── database/
│   └── migrations/
│       ├── 001_initial_schema.sql
│       └── 002_planner_sessions.sql
├── tests/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Current status

Working end to end:

- Express app with a Telegram webhook route and secret validation
- Environment validation
- PostgreSQL pool, transaction helper and tracked migrations
- Structured error handling, JSON body validation, update de-duplication
- Health check that reports live database reachability
- Telegram commands: `/start`, `/help`, `/today`, `/pending`, `/add`, `/done`, `/cancel`
- Task persistence with per-user scoping and `task_history` entries
- Button-driven weekly dashboard with Monday–Sunday navigation
- Day view with fixed commitments, scheduled tasks and unscheduled tasks
- Task cards with Complete, Reschedule, Edit and Cancel, all confirmed
- Guided task creation and editing stored in `planner_sessions`
- Slot suggestions that respect commitments, buffers, rest hours, deadlines and energy
- Weekly review summary

What is **not** implemented yet:

- reminders: the queue table exists but the worker is a skeleton
- automatic (unattended) rescheduling: only the guarded `autoReschedule` path exists
- recurring calendar events are stored but not expanded
- daily reviews and reflections
- AI / natural-language requests

## Roadmap summary

1. Foundation — Express, env, Neon, migrations, health ✅
2. Telegram integration — webhook, `/start`, `/help`, `/today` ✅
3. Task management — create, list, complete, cancel, history ✅
4. Interactive planner — weekly dashboard, guided creation, reschedule, review ✅
5. Reminder engine — persistent queue, worker, retries, interactive buttons
6. Time intelligence — recurring timetable, buffers, controlled unattended rescheduling
7. Reviews and intelligence — daily reviews, patterns, natural-language AI

## Implementation principles

- Reliability before intelligence
- Protect important commitments
- Automate only within explicitly defined boundaries
- Never lose task history
- Respect the user's energy and available time
- Make every automated decision explainable and reversible
