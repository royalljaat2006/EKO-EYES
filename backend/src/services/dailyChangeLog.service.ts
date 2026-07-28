import db from "./alertStore.service";
import { Tier } from "../config/escalation";

/**
 * The per-person audit trail behind the "recovered vs newly inactive" daily
 * numbers. `kpi_snapshot`/`recovery_log` already record the aggregate counts
 * and (for recoveries) a log — this file adds the missing other half: WHICH
 * named CSP went active -> inactive on which day, so the dashboard can answer
 * "who specifically changed today," not just "how many."
 *
 * Written once per day by dailyJob.ts, which diffs today's roster against
 * YESTERDAY'S IMMUTABLE SNAPSHOT (dailySnapshot.service.ts) — not against
 * live `person_state`, which the per-minute refresh used to overwrite before
 * the comparison could happen.
 *
 * Two kinds of row, told apart by `is_new_csp`:
 *  - 0 — a real transition: healthy yesterday, flagged today.
 *  - 1 — a roster addition that arrived ALREADY flagged. Nothing changed
 *    about this person; we simply started seeing them. Counting these as
 *    "newly inactive" would make a sheet import look like a mass outbreak,
 *    so they are surfaced as their own list and excluded from the count and
 *    from repeat-offender history.
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

// Added after the table shipped, so it's a migration. Existing rows predate the
// distinction and were all real transitions, so defaulting to 0 is correct.
// SQLite has no "ADD COLUMN IF NOT EXISTS"; ignore the duplicate-column error.
try {
  db.exec(`ALTER TABLE inactivity_onset_log ADD COLUMN is_new_csp INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — fine.
}

// What the CSP's day-count was in yesterday's snapshot, for context in the UI
// ("was 2d, now 4d"). Null for rows predating this column or for new CSPs.
try {
  db.exec(`ALTER TABLE inactivity_onset_log ADD COLUMN previous_days INTEGER`);
} catch {
  // Column already exists — fine.
}

export interface InactivityOnsetEntry {
  personName: string;
  cspCode: string;
  tier: Tier | null;
  days: number;
  onsetAt: string;
  /** Their day-count in yesterday's snapshot — lets the UI show "was 2d, now 4d". Null when unknown. */
  previousDays: number | null;
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
  /** Real transitions only: healthy yesterday, flagged today. */
  newlyInactive: InactivityOnsetEntry[];
  /** Arrived in the sheet already flagged — a roster addition, deliberately NOT counted as a transition. */
  newCspsAdded: InactivityOnsetEntry[];
  recovered: RecoveryEntry[];
}

/**
 * Called once per CSP that entered a tier today (see dailyJob.ts).
 * `isNewCsp` marks the roster-addition case, which is reported separately
 * from real transitions — see the note at the top of this file.
 */
export function recordInactivityOnset(
  personName: string,
  cspCode: string,
  tier: Tier | null,
  days: number,
  now: string,
  isNewCsp = false,
  previousDays: number | null = null,
): void {
  db.prepare(
    `INSERT INTO inactivity_onset_log (person_name, csp_code, tier, days, onset_at, is_new_csp, previous_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(personName, cspCode, tier, days, now, isNewCsp ? 1 : 0, previousDays);
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
      `SELECT person_name, csp_code, tier, days, onset_at, is_new_csp, previous_days
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
    is_new_csp: number;
    previous_days: number | null;
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

  const toOnset = (r: (typeof onsetRows)[number]): InactivityOnsetEntry => ({
    personName: r.person_name,
    cspCode: r.csp_code,
    tier: r.tier,
    days: r.days,
    onsetAt: r.onset_at,
    previousDays: r.previous_days,
  });

  return {
    day: targetDay,
    newlyInactive: onsetRows.filter((r) => r.is_new_csp === 0).map(toOnset),
    newCspsAdded: onsetRows.filter((r) => r.is_new_csp === 1).map(toOnset),
    recovered: recoveryRows.map((r) => ({
      personName: r.person_name,
      tierAtRecovery: r.tier_at_recovery,
      daysFlagged: r.days_flagged,
      recoveredAt: r.recovered_at,
    })),
  };
}

/**
 * How many times each CSP has CROSSED from active into a tier, in the
 * trailing window — feeds the rule-based "repeat offender" recommendation
 * (insights.service.ts). Pure count over this table's own history, no
 * inference beyond "this happened before."
 *
 * Excludes `is_new_csp` rows on purpose: first appearing in the sheet while
 * already inactive is not a relapse, and counting it as one would label
 * every newly-onboarded CSP a repeat offender on day one.
 */
export function getOnsetCounts(sinceDays = 90): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT csp_code, COUNT(*) AS c FROM inactivity_onset_log
       WHERE onset_at >= datetime('now', ?) AND is_new_csp = 0
       GROUP BY csp_code`,
    )
    .all(`-${sinceDays} days`) as { csp_code: string; c: number }[];
  return new Map(rows.map((r) => [r.csp_code, r.c]));
}
