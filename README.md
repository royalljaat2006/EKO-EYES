# E.Y.E.S. — EKO Yield & Escalation System (Automated Inactivity Alert Agent & Web Dashboard)

Ingests a Google Sheet of inactive personnel, automatically emails + WhatsApps
the responsible RM (Relationship Manager) and DC (Department Coordinator) once
a day for anyone inactive more than 7 days, and serves a web dashboard to
explore the data at 7/14/30-day thresholds.

## Architecture

```
.
├── backend/            Node.js + TypeScript API, scheduler, notification services
│   ├── src/
│   │   ├── config/env.ts            Validated environment configuration (zod)
│   │   ├── services/
│   │   │   ├── googleSheets.service.ts   Sheet ingestion (service account auth)
│   │   │   ├── inactivity.service.ts     Filtering / grouping business logic
│   │   │   ├── email.service.ts          SMTP email via Nodemailer
│   │   │   ├── whatsapp/                 Meta Cloud API + Twilio providers
│   │   │   ├── notification.service.ts   Fan-out to RM + DC on both channels
│   │   │   └── alertStore.service.ts     SQLite audit log of every alert sent
│   │   ├── jobs/
│   │   │   ├── dailyJob.ts               Ingest -> filter -> notify pipeline
│   │   │   └── scheduler.ts              node-cron wrapper (runs inside the API process)
│   │   ├── routes/                       Dashboard REST API
│   │   ├── app.ts / server.ts
│   ├── scripts/runDailyJobOnce.ts        Standalone one-shot runner (for external schedulers)
│   └── .env.example
└── frontend/            React + Vite + TypeScript dashboard (Recharts)
    ├── src/App.tsx, components/FilterBar.tsx, SummaryChart.tsx, DataTable.tsx
    └── .env.example
```

Data flow: Google Sheets → `googleSheets.service` (service-account auth, cached
in-memory for `SHEET_CACHE_TTL_MS`) → `inactivity.service` (threshold
filter/group) → REST API → React dashboard. Separately, `dailyJob.ts` runs once
a day, re-fetches the sheet fresh, filters `Days > 7`, and calls
`notification.service` to email + WhatsApp both the RM and DC for every match,
logging every outcome to SQLite for audit.

## 1. Prerequisites

- Node.js 20+
- A Google Cloud project with the **Google Sheets API** enabled
- The target spreadsheet, with these exact column headers in row 1 (any order
  is fine, matching is case-insensitive):
  `Target Person Name`, `Days`, `RM Email Address`, `RM Mobile Number`,
  `DC Email Address`, `DC Mobile Number`
- SMTP credentials for sending email (Gmail, Outlook 365, SendGrid, AWS SES, ...)
- A WhatsApp sending option: either a Meta WhatsApp Business Cloud API app, or
  a Twilio account with WhatsApp enabled

## 2. Google Sheets service account setup

1. In Google Cloud Console, enable **Google Sheets API** for your project.
2. Create a **Service Account** (IAM & Admin → Service Accounts), then create
   a JSON key for it and download it.
3. Open the target spreadsheet and **Share** it with the service account's
   `client_email` (found in the JSON key), Viewer access is enough.
4. Encode the JSON key to a single-line base64 string and put it in
   `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`:
   - macOS/Linux: `base64 -w0 service-account.json`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))`
   (Alternatively, for local dev only, drop the raw JSON file at
   `backend/secrets/service-account.json` and set
   `GOOGLE_APPLICATION_CREDENTIALS` to that path instead.)
5. Copy the spreadsheet ID from its URL into `GOOGLE_SHEETS_SPREADSHEET_ID`,
   and set `GOOGLE_SHEETS_RANGE` to cover the header + data (e.g. `Sheet1!A1:F`).

## 3. Email (SMTP) setup

Any standard SMTP provider works. Example for Gmail with an
[App Password](https://myaccount.google.com/apppasswords):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your.account@gmail.com
SMTP_PASS=<16-character app password>
ALERT_EMAIL_FROM="Inactivity Alerts <your.account@gmail.com>"
```

## 4. WhatsApp setup (choose one provider)

### Option A — Meta WhatsApp Cloud API (`WHATSAPP_PROVIDER=meta`)

1. Create a Meta app at [developers.facebook.com](https://developers.facebook.com/)
   with the WhatsApp product added, and a WhatsApp Business Account.
2. Note the **Phone Number ID** and generate a permanent **access token**
   (System User token in Business Manager, not a 24h test token).
3. Create and get approval for a message **template** with a single body
   variable (e.g. body: `{{1}}`) — business-initiated messages outside a live
   customer conversation must use an approved template. Set its name/language
   in `WHATSAPP_META_TEMPLATE_NAME` / `WHATSAPP_META_TEMPLATE_LANG`.
4. Fill in `WHATSAPP_META_PHONE_NUMBER_ID` and `WHATSAPP_META_ACCESS_TOKEN`.

### Option B — Twilio (`WHATSAPP_PROVIDER=twilio`)

1. Enable WhatsApp on a Twilio number (sandbox for testing, or a production
   sender after Meta approval via Twilio).
2. Fill in `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
   `TWILIO_WHATSAPP_FROM` (must include the `whatsapp:` prefix).

Mobile numbers in the sheet should include a country code (e.g. `+9198XXXXXXX`);
a leading `+` is added automatically if missing.

## 5. Configure environment variables

```bash
cd backend
cp .env.example .env
# edit .env with the values from steps 2-4 above

cd ../frontend
cp .env.example .env.local
# defaults to http://localhost:4000/api, adjust if the API runs elsewhere
```

`.env` files are gitignored — never commit real credentials. Secrets (service
account JSON, `.env`) stay out of version control via `backend/.gitignore`.

## 6. Install & run

```bash
# Backend
cd backend
npm install
npm run dev        # http://localhost:4000, runs the API + the daily cron scheduler

# Frontend (separate terminal)
cd frontend
npm install
npm run dev         # http://localhost:5173
```

Production build:

```bash
cd backend && npm run build && npm start
cd frontend && npm run build   # serve dist/ behind any static host / reverse proxy
```

## 7. Automation (daily run)

The backend process (`npm start` / `npm run dev`) schedules the ingestion +
alert pipeline internally via `node-cron`, using `DAILY_JOB_CRON` (default
`0 9 * * *`, i.e. 09:00 in `TIMEZONE`, default `Asia/Kolkata`). As long as the
server keeps running (e.g. under `pm2`, Docker, or a Linux service), the job
fires automatically every day — no external scheduler required.

If you'd rather not keep a long-running process, use the standalone one-shot
script with an OS-level scheduler instead:

```bash
npm run job:run-once       # ts-node dev entrypoint
# or, after `npm run build`:
npm run job:run-once:build
```

**Windows Task Scheduler** example (daily at 09:00):

```powershell
schtasks /Create /SC DAILY /ST 09:00 /TN "InactivityAlertDailyJob" ^
  /TR "cmd /c cd /d D:\EKO\AI AGENT FOR INACTIVE TRACKING\backend && npm run job:run-once:build"
```

**Linux/macOS cron** example:

```cron
0 9 * * * cd /path/to/backend && npm run job:run-once:build >> /var/log/inactivity-job.log 2>&1
```

Every run (whether from the internal scheduler, the manual trigger endpoint,
or the standalone script) is logged to SQLite (`backend/data/app.sqlite`) with
per-recipient, per-channel success/failure detail, viewable via
`GET /api/job-runs` and `GET /api/job-runs/:id/alerts`.

## 8. Dashboard API reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check |
| GET | `/api/inactivity?threshold=7\|14\|30` | Records with `Days >= threshold`, grouped counts by RM |
| GET | `/api/job-runs` | Recent daily job executions |
| GET | `/api/job-runs/:id/alerts` | Notification outcomes for one run |
| POST | `/api/job-runs/trigger` | Manually run the ingestion + alert pipeline on demand |

Note the dashboard filter uses `Days >= threshold` (an "inactive for at least N
days" view), while the automated alert pipeline uses `Days > 7` strictly, per
the alerting spec.

## 9. Security notes

- All secrets (Google service account key, SMTP password, WhatsApp tokens) are
  read from environment variables validated at startup (`src/config/env.ts`);
  the process refuses to start if required secrets are missing.
- `.env`, `backend/secrets/`, and the SQLite database are gitignored.
- The API applies `helmet` security headers and a configurable CORS allowlist
  (`DASHBOARD_CORS_ORIGIN`).
- The Google service account is granted **read-only** access to the sheet.
- Rotate the WhatsApp access token / SMTP password periodically; the app reads
  them fresh from `.env` on each restart.
