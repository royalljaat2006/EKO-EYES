import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DASHBOARD_CORS_ORIGIN: z.string().default("http://localhost:5173"),
  SERVER_BASE_URL: z.string().default("http://localhost:4000"),

  // --- Security / access control (ISO 27001 A.5.15, A.8.5) ------------------
  /** Password required to open the dashboard. If unset, data routes fail closed. */
  DASHBOARD_PASSWORD: z.string().default(""),
  /**
   * Secret used to sign session tokens (HMAC). Set a long random value in prod.
   * If unset, one is generated at boot — tokens then reset on every restart.
   */
  AUTH_TOKEN_SECRET: z.string().default(""),
  /** Session token lifetime in hours. */
  AUTH_TOKEN_TTL_HOURS: z.coerce.number().default(12),
  /**
   * Meta app secret used to verify the X-Hub-Signature-256 on inbound WhatsApp
   * webhooks (A.5.14 information-transfer integrity). If unset, the webhook
   * rejects everything — fail closed.
   */
  WHATSAPP_APP_SECRET: z.string().default(""),

  /** Where CSP data comes from: the local Calling Sheet workbook, or Google Sheets. */
  DATA_SOURCE: z.enum(["excel", "google"]).default("excel"),
  EXCEL_FILE_PATH: z.string().default("./data/Calling Sheet.xlsx"),
  /** RM/DC name -> email + mobile. The Calling Sheet has no contact details. */
  CONTACTS_FILE_PATH: z.string().default("./data/RM_DC_Contacts.xlsx"),

  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().default(""),
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  INACTIVITY_THRESHOLD_DAYS: z.coerce.number().default(7),

  /** Escalation contacts. Comma-separated. Mobiles are optional. */
  ESCALATION_MANAGER_EMAILS: z.string().default(""),
  ESCALATION_MANAGER_MOBILES: z.string().default(""),
  ESCALATION_LEADERSHIP_EMAILS: z.string().default(""),
  ESCALATION_LEADERSHIP_MOBILES: z.string().default(""),

  /** The business goal: keep inactivity at or below this percentage. */
  TARGET_INACTIVITY_RATE: z.coerce.number().default(2),

  // --- CSP contact guardrails -------------------------------------------------
  // A CSP is a person, not a ticket queue. These limits exist so the agent
  // cannot harass someone into blocking the channel entirely.

  /** Hard cap on nudges to one CSP. After this, messaging has failed — a human calls. */
  CSP_MAX_NUDGES: z.coerce.number().default(3),
  /** Minimum days between two messages to the same CSP (1 = may message daily). */
  CSP_NUDGE_COOLDOWN_DAYS: z.coerce.number().default(1),
  /**
   * Terminal statuses that mean the CSP CAN actually transact. Anyone outside
   * this list is a technical problem, not a motivation problem, and is never
   * nudged — nagging someone whose device is dead is both cruel and useless.
   */
  CSP_ACTIVE_TERMINAL_STATUSES: z.string().default("active"),

  /** Where dead-terminal CSPs get routed instead of being nagged. */
  SUPPORT_EMAILS: z.string().default(""),
  SUPPORT_MOBILES: z.string().default(""),

  /** Meta webhook verification token for inbound WhatsApp replies. */
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default(""),
  /** The daily send: ingest -> tier -> guardrails -> notify. Default 12:00 PM. */
  DAILY_JOB_CRON: z.string().default("0 12 * * *"),
  /**
   * Recurring sheet refresh: re-reads the live spreadsheet and warms the
   * cache, so the dashboard is never far out of date and any layout/
   * connectivity problem is caught well before the noon send. Sends NO
   * notifications itself. Default every 1 minute — the cadence a live
   * viewer actually experiences is bounded by SHEET_CACHE_TTL_MS below, so
   * keep the two in step.
   */
  SHEET_REFRESH_CRON: z.string().default("* * * * *"),
  TIMEZONE: z.string().default("Asia/Kolkata"),
  /** How long a cached sheet read is served before any request forces a fresh one. Keep in step with SHEET_REFRESH_CRON. */
  SHEET_CACHE_TTL_MS: z.coerce.number().default(60_000),

  EMAIL_PROVIDER: z.enum(["smtp", "gmail_api"]).default("smtp"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_SECURE: z.coerce.boolean().default(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().min(1, "ALERT_EMAIL_FROM is required"),

  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_USER_EMAIL: z.string().optional(),

  WHATSAPP_PROVIDER: z.enum(["meta", "twilio", "goinfinito"]).default("meta"),

  WHATSAPP_META_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_META_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_META_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_META_TEMPLATE_NAME: z.string().default("inactivity_alert"),
  WHATSAPP_META_TEMPLATE_LANG: z.string().default("en_US"),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  CERF_API_KEY: z.string().optional(),
  CERF_FROM: z.string().optional(),
  CERF_TEMPLATE_ID: z.string().optional(),
  CERF_DLR_URL: z.string().optional(),

  SQLITE_DB_PATH: z.string().default("./data/app.sqlite"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:\n", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed. Check your .env file against .env.example.");
}

const env = parsed.data;

if (env.EMAIL_PROVIDER === "smtp") {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    throw new Error("EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER, and SMTP_PASS");
  }
}

if (env.EMAIL_PROVIDER === "gmail_api") {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_USER_EMAIL) {
    throw new Error(
      "EMAIL_PROVIDER=gmail_api requires GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_USER_EMAIL",
    );
  }
}

if (env.WHATSAPP_PROVIDER === "meta") {
  if (!env.WHATSAPP_META_PHONE_NUMBER_ID || !env.WHATSAPP_META_ACCESS_TOKEN) {
    throw new Error(
      "WHATSAPP_PROVIDER=meta requires WHATSAPP_META_PHONE_NUMBER_ID and WHATSAPP_META_ACCESS_TOKEN",
    );
  }
}

if (env.WHATSAPP_PROVIDER === "twilio") {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
    throw new Error(
      "WHATSAPP_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM",
    );
  }
}

if (env.WHATSAPP_PROVIDER === "goinfinito") {
  if (!env.CERF_API_KEY || !env.CERF_FROM || !env.CERF_TEMPLATE_ID) {
    throw new Error(
      "WHATSAPP_PROVIDER=goinfinito requires CERF_API_KEY, CERF_FROM, and CERF_TEMPLATE_ID",
    );
  }
}

if (env.DATA_SOURCE === "google") {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    throw new Error("DATA_SOURCE=google requires GOOGLE_SHEETS_SPREADSHEET_ID");
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 && !env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      "DATA_SOURCE=google requires GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 or GOOGLE_APPLICATION_CREDENTIALS",
    );
  }
}

export type Env = typeof env;
export default env;
