import db from "./alertStore.service";
import { Tier } from "../config/escalation";

/**
 * The per-person audit trail behind the "recovered vs newly inactive" daily
 * numbers. `kpi_snapshot`/`recovery_log` already record the aggregate counts
 * and (for recoveries) a log — this file adds the missing other half: WHICH
 * named CSP went active -> inactive on which day, so the dashboard can answer
 * "who specifically changed today," not just "how many."
 *
 * Reviewed daily by dailyJob.ts: every run diffs today's evaluated roster
 * against yesterday's `person_state` (already-existing logic in
 * escalation.service.ts) and calls `recordInactivityOnset` for each CSP that
 * crossed from active into a tier for the first time.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS inactivity_onset_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_name TEXT NOT NULL,
    csp_code TEXT NOT NULL,
    tier TEXT,
    days INTEGER,
    onset_at TEXT NOT NULL
  );
`);

export interface InactivityOnsetEntry {
  personName: string;
  cspCode: string;
  tier: Tier | null;
  days: number;
  onsetAt: string;
}

export interface RecoveryEntry {
  personName: string;
  tierAtRecovery: Tier | null;
  daysFlagged: number | null;
  recoveredAt: string;
}

export interface DailyChanges {
  /** YYYY-MM-DD this covers. */
  day: string;
  newlyInactive: InactivityOnsetEntry[];
  recovered: RecoveryEntry[];
}

/** Called once per CSP that just entered a tier for the first time (see dailyJob.ts step 2). */
export function recordInactivityOnset(
  personName: string,
  cspCode: string,
  tier: Tier | null,
  days: number,
  now: string,
): void {
  db.prepare(
    `INSERT INTO inactivity_onset_log (person_name, csp_code, tier, days, onset_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(personName, cspCode, tier, days, now);
}

/**
 * Everyone who changed status on a given day (default: today) — both
 * directions. `day` is compared against the DATE portion of the stored ISO
 * timestamp, so it works the same regardless of what time of day a run fires.
 */
export function getDailyChanges(day?: string): DailyChanges {
  const targetDay = day ?? new Date().toISOString().slice(0, 10);

  const onsetRows = db
    .prepare(
      `SELECT person_name, csp_code, tier, days, onset_at
       FROM inactivity_onset_log
       WHERE date(onset_at) = date(?)
       ORDER BY days DESC`,
    )
    .all(targetDay) as {
    person_name: string;
    csp_code: string;
    tier: Tier | null;
    days: number;
    onset_at: string;
  }[];

  const recoveryRows = db
    .prepare(
      `SELECT person_name, tier_at_recovery, days_flagged, recovered_at
       FROM recovery_log
       WHERE date(recovered_at) = date(?)
       ORDER BY recovered_at DESC`,
    )
    .all(targetDay) as {
    person_name: string;
    tier_at_recovery: Tier | null;
    days_flagged: number | null;
    recovered_at: string;
  }[];

  return {
    day: targetDay,
    newlyInactive: onsetRows.map((r) => ({
      personName: r.person_name,
      cspCode: r.csp_code,
      tier: r.tier,
      days: r.days,
      onsetAt: r.onset_at,
    })),
    recovered: recoveryRows.map((r) => ({
      personName: r.person_name,
      tierAtRecovery: r.tier_at_recovery,
      daysFlagged: r.days_flagged,
      recoveredAt: r.recovered_at,
    })),
  };
}
