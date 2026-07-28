import db from "./alertStore.service";
import { Tier } from "../config/escalation";
import { KpiSnapshot } from "../types";
import { RangeOption } from "../config/inactivityRanges";

// person_state used to be keyed by person_name. A name edit in the source
// sheet (typo fix, capitalization, adding a surname) then looked exactly
// like "the old name recovered" + "a brand new person went inactive" — same
// physical CSP, counted as two. Re-keyed by csp_code (stable) instead. If
// an old name-keyed table is still around, rename it aside (kept for
// reference/audit, never auto-deleted) rather than migrating its rows: the
// only rows worth preserving are ones whose name DIDN'T change, and those
// will simply reappear as "entered-tier" once on the next run — a one-time,
// harmless bookkeeping reset (resendEveryDays=1 on every tier already means
// a currently-flagged CSP is messaged daily regardless of the reason label;
// see SKILLS.md "Key state by csp_code, not name").
const personStateCols = db.pragma(`table_info(person_state)`) as { name: string }[];
if (personStateCols.length > 0 && !personStateCols.some((c) => c.name === "csp_code")) {
  db.exec(`ALTER TABLE person_state RENAME TO person_state_legacy_by_name`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS person_state (
    csp_code TEXT PRIMARY KEY,
    person_name TEXT NOT NULL,
    tier TEXT,
    days INTEGER NOT NULL,
    first_flagged_at TEXT,
    last_notified_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recovery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_name TEXT NOT NULL,
    tier_at_recovery TEXT,
    days_flagged INTEGER,
    recovered_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kpi_snapshot (
    day TEXT PRIMARY KEY,
    total_people INTEGER NOT NULL,
    inactive_count INTEGER NOT NULL,
    inactivity_rate REAL NOT NULL,
    at_risk_count INTEGER NOT NULL,
    new_breaches INTEGER NOT NULL,
    recoveries INTEGER NOT NULL
  );
`);

// Added after the table above already shipped, so it's a migration rather than
// part of CREATE TABLE — lets the daily-range breakdown (used by the dashboard's
// range-filtered trend chart) be recorded per day without losing older rows.
// SQLite has no "ADD COLUMN IF NOT EXISTS"; ignore the "duplicate column" error.
try {
  db.exec(`ALTER TABLE kpi_snapshot ADD COLUMN range_counts TEXT`);
} catch {
  // Column already exists — fine.
}

// Same story: CSPs that crossed from active into ANY tier for the first time
// today (day 3+, including the self-nudge floor) — distinct from the existing
// `new_breaches`, which deliberately excludes the self tier. This is what
// feeds the "recovered vs newly inactive" daily-change chart.
try {
  db.exec(`ALTER TABLE kpi_snapshot ADD COLUMN newly_inactive INTEGER`);
} catch {
  // Column already exists — fine.
}

// How many nudges the CSP had already received when they recovered — the
// signal the adaptive-tuning loop (adaptiveTuning.service.ts) learns from.
// Null for rows recorded before this column existed, or when the recovered
// person had no CSP code to look up.
try {
  db.exec(`ALTER TABLE recovery_log ADD COLUMN nudge_count_at_recovery INTEGER`);
} catch {
  // Column already exists — fine.
}

// The stable identifier alongside person_name, for the same reason
// person_state was re-keyed above — lets a name change be told apart from
// an actual recovery when auditing this table later. Null for rows
// recorded before this column existed.
try {
  db.exec(`ALTER TABLE recovery_log ADD COLUMN csp_code TEXT`);
} catch {
  // Column already exists — fine.
}

// Who the CSP was assigned to AT THE MOMENT of recovery — the attribution
// RM/DC performance stats (rmDcPerformance.service.ts) are computed from.
// Null when the recovery was recorded without record context to hand (e.g.
// the background sync path), or for rows predating this column.
try {
  db.exec(`ALTER TABLE recovery_log ADD COLUMN rm_name TEXT`);
} catch {
  // Column already exists — fine.
}
try {
  db.exec(`ALTER TABLE recovery_log ADD COLUMN dc_name TEXT`);
} catch {
  // Column already exists — fine.
}

export interface PersonState {
  cspCode: string;
  personName: string;
  tier: Tier | null;
  days: number;
  firstFlaggedAt: string | null;
  lastNotifiedAt: string | null;
}

interface PersonStateRow {
  csp_code: string;
  person_name: string;
  tier: Tier | null;
  days: number;
  first_flagged_at: string | null;
  last_notified_at: string | null;
}

/** Keyed by csp_code — see the migration note above CREATE TABLE person_state. */
export function loadPersonStates(): Map<string, PersonState> {
  const rows = db
    .prepare(
      `SELECT csp_code, person_name, tier, days, first_flagged_at, last_notified_at FROM person_state`,
    )
    .all() as PersonStateRow[];

  return new Map(
    rows.map((r) => [
      r.csp_code,
      {
        cspCode: r.csp_code,
        personName: r.person_name,
        tier: r.tier,
        days: r.days,
        firstFlaggedAt: r.first_flagged_at,
        lastNotifiedAt: r.last_notified_at,
      },
    ]),
  );
}

export function upsertPersonState(
  cspCode: string,
  personName: string,
  tier: Tier | null,
  days: number,
  notifiedNow: boolean,
  now: string,
): void {
  db.prepare(
    `INSERT INTO person_state (csp_code, person_name, tier, days, first_flagged_at, last_notified_at, updated_at)
     VALUES (@cspCode, @personName, @tier, @days, @now, @lastNotified, @now)
     ON CONFLICT(csp_code) DO UPDATE SET
       person_name = @personName,
       tier = @tier,
       days = @days,
       first_flagged_at = COALESCE(person_state.first_flagged_at, @now),
       last_notified_at = COALESCE(@lastNotified, person_state.last_notified_at),
       updated_at = @now`,
  ).run({ cspCode, personName, tier, days, now, lastNotified: notifiedNow ? now : null });
}

/** Clears tier state and records the recovery — the metric that proves impact. */
export function recordRecovery(
  cspCode: string,
  personName: string,
  now: string,
  nudgeCountAtRecovery: number | null = null,
  rmName: string | null = null,
  dcName: string | null = null,
): void {
  const state = db
    .prepare(`SELECT tier, days, first_flagged_at FROM person_state WHERE csp_code = ?`)
    .get(cspCode) as
    | { tier: Tier | null; days: number; first_flagged_at: string | null }
    | undefined;

  const daysFlagged =
    state?.first_flagged_at != null
      ? Math.max(
          0,
          Math.floor(
            (new Date(now).getTime() - new Date(state.first_flagged_at).getTime()) / 86_400_000,
          ),
        )
      : null;

  db.prepare(
    `INSERT INTO recovery_log (person_name, tier_at_recovery, days_flagged, recovered_at, nudge_count_at_recovery, csp_code, rm_name, dc_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(personName, state?.tier ?? null, daysFlagged, now, nudgeCountAtRecovery, cspCode, rmName, dcName);

  db.prepare(
    `UPDATE person_state SET tier = NULL, first_flagged_at = NULL, last_notified_at = NULL,
     updated_at = ? WHERE csp_code = ?`,
  ).run(now, cspCode);
}

/** Older rows predate the range_counts column; those days simply have none. */
function parseRangeCounts(raw: string | null): Partial<Record<RangeOption, number>> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveKpiSnapshot(s: KpiSnapshot): void {
  db.prepare(
    `INSERT INTO kpi_snapshot (day, total_people, inactive_count, inactivity_rate,
       at_risk_count, new_breaches, recoveries, range_counts, newly_inactive)
     VALUES (@day, @totalPeople, @inactiveCount, @inactivityRate, @atRiskCount,
       @newBreaches, @recoveries, @rangeCounts, @newlyInactive)
     ON CONFLICT(day) DO UPDATE SET
       total_people = @totalPeople,
       inactive_count = @inactiveCount,
       inactivity_rate = @inactivityRate,
       at_risk_count = @atRiskCount,
       new_breaches = @newBreaches,
       recoveries = @recoveries,
       range_counts = @rangeCounts,
       newly_inactive = @newlyInactive`,
  ).run({
    ...s,
    rangeCounts: s.rangeCounts ? JSON.stringify(s.rangeCounts) : null,
    newlyInactive: s.newlyInactive ?? null,
  });
}

export function getKpiTrend(days = 30): KpiSnapshot[] {
  const rows = db
    .prepare(
      `SELECT day, total_people, inactive_count, inactivity_rate, at_risk_count,
              new_breaches, recoveries, range_counts, newly_inactive
       FROM kpi_snapshot ORDER BY day DESC LIMIT ?`,
    )
    .all(days) as Record<string, never>[];

  return rows
    .map((r) => ({
      day: r["day"] as unknown as string,
      totalPeople: r["total_people"] as unknown as number,
      inactiveCount: r["inactive_count"] as unknown as number,
      inactivityRate: r["inactivity_rate"] as unknown as number,
      atRiskCount: r["at_risk_count"] as unknown as number,
      newBreaches: r["new_breaches"] as unknown as number,
      recoveries: r["recoveries"] as unknown as number,
      rangeCounts: parseRangeCounts(r["range_counts"] as unknown as string | null),
      // Older rows predate this column; null (not 0) means "we don't know",
      // so the chart can skip it instead of drawing a fake zero.
      newlyInactive: (r["newly_inactive"] as unknown as number | null) ?? null,
    }))
    .reverse();
}

export function countRecoveries(sinceDays = 30): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM recovery_log
       WHERE recovered_at >= datetime('now', ?)`,
    )
    .get(`-${sinceDays} days`) as { c: number };
  return row.c;
}

export interface RecentRecovery {
  personName: string;
  rmName: string | null;
  dcName: string | null;
  daysFlagged: number | null;
  recoveredAt: string;
}

/** Feeds RM/DC performance stats (analytics.service.ts) — who recovered, attributed to whoever was assigned to them at the time. */
export function getRecentRecoveries(sinceDays = 30): RecentRecovery[] {
  const rows = db
    .prepare(
      `SELECT person_name, rm_name, dc_name, days_flagged, recovered_at FROM recovery_log
       WHERE recovered_at >= datetime('now', ?)`,
    )
    .all(`-${sinceDays} days`) as {
    person_name: string;
    rm_name: string | null;
    dc_name: string | null;
    days_flagged: number | null;
    recovered_at: string;
  }[];

  return rows.map((r) => ({
    personName: r.person_name,
    rmName: r.rm_name,
    dcName: r.dc_name,
    daysFlagged: r.days_flagged,
    recoveredAt: r.recovered_at,
  }));
}

// NOTE: a `syncInactivityState()` used to live here and was called from
// `fetchRecords()` — i.e. every minute, and on every dashboard request. It ran
// detectRecoveries + upsertPersonState on that fast path, which meant the noon
// job's baseline ("what did yesterday look like?") was already overwritten with
// today's values before it ever got to compare. Result: `entered-tier` never
// fired, `inactivity_onset_log` stayed empty, recoveries were logged at random
// times with null RM/DC attribution, and new_breaches/newly_inactive were
// permanently 0.
//
// Day-over-day comparison now has one owner: the daily job, reading an
// immutable per-day baseline from dailySnapshot.service.ts. Nothing on the
// read path may write state — see SKILLS.md "Fast raw refresh, slow-cadence
// logic" and the note atop dataSource.service.ts.
