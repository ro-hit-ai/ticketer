# Ticketer

Full-stack ticketing and communication platform with:
- `apps/api`: Node.js + Express + MongoDB backend
- `apps/client`: React + Vite admin/agent/portal frontend

## Core Features

- Ticket and thread management
- Inbound/outbound email flows (IMAP + SMTP)
- Role and permission based access
- Mailbox and queue administration
- Admin operations views (threads, messages, logs)

## Mailer Reliability Features (Implemented)

- Outbound job queue with retry/backoff and dead-letter handling
- Worker-based async email delivery
- Delivery audit events:
  - `job_enqueued`
  - `job_retry`
  - `job_dead`
  - `job_sent`
- Monitoring metrics and latency percentiles
- Admin Mailer Ops page with dead-letter retry actions
- Audit Explorer with filter + pagination support

## Tech Stack

- Backend: Node.js, Express, Mongoose, Nodemailer, IMAP libraries
- Frontend: React, Vite, Tailwind, Recharts
- Database: MongoDB

## Project Structure

```text
ticketer/
  apps/
    api/       # Backend API
    client/    # Frontend app
  docs/
```

## Prerequisites

- Node.js 18+ recommended
- npm 9+ (or compatible)
- MongoDB instance

## Local Setup

### 1) Clone and install

```bash
git clone <your-repo-url>
cd ticketer
```

Install dependencies per app:

```bash
cd apps/api && npm install
cd ../client && npm install
```

### 2) Configure backend environment

Create `apps/api/.env` (or update existing) with at least:

```env
PORT=5005
MONGODB_URI=mongodb://localhost:27017/peppermint
JWT_SECRET=change_me

# Optional but common
CORS_ALLOWED_ORIGINS=http://localhost:5173
SEED_ADMIN_ON_STARTUP=false

# Email queue worker (defaults shown)
OUTBOUND_EMAIL_WORKER_ENABLED=true
OUTBOUND_EMAIL_QUEUE_POLL_MS=3000
OUTBOUND_EMAIL_QUEUE_LOCK_MS=60000
OUTBOUND_EMAIL_MAX_ATTEMPTS=5
```

### 3) Run backend

```bash
cd apps/api
npm run dev
```

Backend default URL: `http://localhost:5005`

### 4) Run frontend

```bash
cd apps/client
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Build Commands

### Backend

```bash
cd apps/api
npm start
```

### Frontend

```bash
cd apps/client
npm run build
npm run preview
```

## Key API Endpoints (Mailer Ops)

- `GET /api/v1/monitoring/mailer?windowHours=24`
  - Returns totals, success/dead/retry counts, latency (`p50`, `p95`), hourly trends.
- `GET /api/v1/email-queue/jobs?status=dead&limit=100`
  - Fetch dead-letter jobs.
- `POST /api/v1/email-queue/jobs/:id/retry`
  - Requeue a failed/dead job.
- `GET /api/v1/audit-logs`
  - Filterable audit logs.
  - Query params: `eventType`, `entityType`, `entityId`, `startDate`, `endDate`, `page`, `limit`.

## Admin UI Notes

- Main admin routes are under `/admin/...`
- Mailer reliability dashboard is at:
  - `/admin/mailer-ops`
- Message operations page:
  - `/admin/messages`

## Scripts (Backend)

- `npm run dev` - Start API with nodemon
- `npm start` - Start API with node
- `npm run admin:create` - Create admin user helper
- `npm run smoke:test` - Smoke test script
- `npm run migrate:email-body-text` - Data migration script

## Troubleshooting

- If login/API calls fail with 401:
  - verify `JWT_SECRET`
  - verify frontend is using correct API base URL
- If CORS issues occur:
  - set `CORS_ALLOWED_ORIGINS` to frontend origin(s)
- If emails are not sending:
  - verify active email queue configuration
  - check `/admin/mailer-ops` dead-letter and audit entries
  - ensure worker is enabled (`OUTBOUND_EMAIL_WORKER_ENABLED=true`)

## License

MIT (see `license` file).
