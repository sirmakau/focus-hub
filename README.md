# Focus Hub

Focus Hub is a personal productivity and life-management assistant.

**Primary interface:** Telegram  
**Backend:** Node.js + Express  
**Database:** Neon PostgreSQL  
**Language:** JavaScript (ES modules)  
**Timezone:** Africa/Nairobi (default)

This repository is the backend for Focus Hub 2.0, built according to the product specification in `../focushub.txt`.

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

## Setup

```bash
cd focus-hub
cp .env.example .env
```

Edit `.env` with real values:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `AUTHORIZED_TELEGRAM_USER_IDS`
- `DATABASE_URL`
- `APP_URL` and `PORT` if needed

Then install dependencies:

```bash
npm install
```

## Development

```bash
npm run dev
```

The webhook endpoint is:

```
POST /telegram/webhook
```

There is also a health endpoint:

```
GET /health
```

## Database

Migrations live in `database/migrations/`. The initial schema is intended to be run only after Neon is reachable and `.env` is configured.

```bash
npm run db:migrate
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
- Service/repository/worker skeletons for the planned feature set

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
