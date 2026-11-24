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
  "environment": "development",
  "timestamp": "2026-02-02T10:00:00.000Z"
}
```

### Type checking

Optional strictness check using the project `tsconfig.json`:

```bash
npm run type-check
```

This is currently informational. The source files are plain JavaScript; stricter typing would require `@types/*` packages and/or JSDoc annotations.

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
│   │   ├── telegram.js
│   │   ├── commands.js
│   │   └── callbacks.js
│   ├── routes/
│   │   └── webhook.routes.js
│   ├── controllers/
│   │   └── telegram.controller.js
│   ├── services/
│   │   ├── task.service.js
│   │   ├── schedule.service.js
│   │   ├── energy.service.js
│   │   ├── reminder.service.js
│   │   └── review.service.js
│   ├── repositories/
│   │   ├── task.repository.js
│   │   ├── schedule.repository.js
│   │   └── reminder.repository.js
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
│       └── 001_initial_schema.sql
├── tests/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Current status

This is the Phase 1 foundation skeleton:

- Express app with a Telegram webhook route
- Environment validation
- PostgreSQL pool and transaction helper
- Structured error handling
- Webhook secret middleware
- Health check
- Initial PostgreSQL migration file
- Service, repository, and worker skeletons for the planned feature set

What is **not** implemented yet:

- full Telegram command handling beyond skeletons
- task persistence
- reminder queue and worker behavior
- scheduling engine
- AI features

## Roadmap summary

1. Foundation — Express, env, Neon, migrations, health
2. Telegram integration — webhook, `/start`, `/help`, `/today`
3. Task management — create, list, complete, skip, reschedule, history
4. Reminder engine — persistent queue, worker, retries, interactive buttons
5. Time intelligence — timetable, fixed commitments, buffers, controlled rescheduling, energy
6. Reviews and intelligence — daily/weekly reviews, patterns, natural-language AI

## Implementation principles

- Reliability before intelligence
- Protect important commitments
- Automate only within explicitly defined boundaries
- Never lose task history
- Respect the user's energy and available time
- Make every automated decision explainable and reversible
