import db from "./alertStore.service";
import env from "../config/env";

/**
 * Runtime configuration an operator can change from the dashboard, without a
 * redeploy or an .env edit.
 *
 * Every key is an OVERRIDE, not a replacement: a row absent from the table
 * means "use what .env says". That ordering matters — a fresh database, a
 * wiped table, or a key added in a later release all fall back to the
 * existing env behaviour rather than to a hardcoded guess. Values are stored
 * as TEXT and coerced on read, since SQLite has no boolean type.
 *
 * Reads go straight to SQLite every time (no in-process cache). It's a local
 * file and these are tiny single-row lookups, but more importantly the kill
 * switches below have to take effect the moment they're saved — a cached
 * `email_enabled` that lags by even one job run defeats the point of having
 * a kill switch at all.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

export interface AppSettings {
  /** Master switch for ALL outbound email. Off = the daily job sends none. */
  emailEnabled: boolean;
  /** Master switch for ALL outbound WhatsApp, including manual one-off nudges. */
  whatsappEnabled: boolean;
  /** Days of inactivity past which a CSP counts toward the inactivity rate. */
  inactivityThresholdDays: number;
  /** The business goal: keep the inactivity rate at or below this percentage. */
  targetInactivityRate: number;
  /** Hard cap on nudges to one CSP before a human has to call instead. */
  cspMaxNudges: number;
  /** Minimum days between two messages to the same CSP (1 = may message daily). */
  cspNudgeCooldownDays: number;
}

/** DB key <-> field name. The DB uses snake_case so the rows read like config. */
const KEYS = {
  emailEnabled: "email_enabled",
  whatsappEnabled: "whatsapp_enabled",
  inactivityThresholdDays: "inactivity_threshold_days",
  targetInactivityRate: "target_inactivity_rate",
  cspMaxNudges: "csp_max_nudges",
  cspNudgeCooldownDays: "csp_nudge_cooldown_days",
} as const satisfies Record<keyof AppSettings, string>;

/** What each setting falls back to when it has never been saved. */
export function settingDefaults(): AppSettings {
  return {
    // Nothing in .env disables a channel today, so delivery stays on until an
    // operator deliberately turns it off here.
    emailEnabled: true,
    whatsappEnabled: true,
    inactivityThresholdDays: env.INACTIVITY_THRESHOLD_DAYS,
    targetInactivityRate: env.TARGET_INACTIVITY_RATE,
    cspMaxNudges: env.CSP_MAX_NUDGES,
    cspNudgeCooldownDays: env.CSP_NUDGE_COOLDOWN_DAYS,
  };
}

function readRaw(key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function writeRaw(key: string, value: string, now: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
  ).run(key, value, now, value, now);
}

/** A stored value that isn't a recognisable boolean is treated as unset — never as `false`, which would silence a channel by accident. */
export function getBoolSetting(field: "emailEnabled" | "whatsappEnabled"): boolean {
  const raw = readRaw(KEYS[field]);
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return settingDefaults()[field];
}

/** Same idea for numbers: a non-numeric or missing row falls back to .env. */
export function getNumberSetting(
  field: "inactivityThresholdDays" | "targetInactivityRate" | "cspMaxNudges" | "cspNudgeCooldownDays",
): number {
  const raw = readRaw(KEYS[field]);
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : settingDefaults()[field];
}

/** The full effective configuration — saved overrides layered on the .env defaults. */
export function getSettings(): AppSettings {
  return {
    emailEnabled: getBoolSetting("emailEnabled"),
    whatsappEnabled: getBoolSetting("whatsappEnabled"),
    inactivityThresholdDays: getNumberSetting("inactivityThresholdDays"),
    targetInactivityRate: getNumberSetting("targetInactivityRate"),
    cspMaxNudges: getNumberSetting("cspMaxNudges"),
    cspNudgeCooldownDays: getNumberSetting("cspNudgeCooldownDays"),
  };
}

/**
 * Upserts only the keys present in `patch` and returns the full effective
 * settings afterwards. Omitted keys are left alone rather than reset, so a
 * partial save from one panel can never clobber a setting another panel owns.
 */
export function updateSettings(
  patch: Partial<AppSettings>,
  now: string = new Date().toISOString(),
): AppSettings {
  const apply = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) writeRaw(key, value, now);
  });

  const entries: [string, string][] = [];
  for (const [field, key] of Object.entries(KEYS) as [keyof AppSettings, string][]) {
    const value = patch[field];
    if (value === undefined) continue;
    entries.push([key, typeof value === "boolean" ? String(value) : String(value)]);
  }
  apply(entries);

  return getSettings();
}
