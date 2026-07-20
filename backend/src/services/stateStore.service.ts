import db from "./alertStore.service";
import { Tier } from "../config/escalation";
import { KpiSnapshot } from "../types";
import { RangeOption } from "../config/inactivityRanges";

db.exec(`
  CREATE TABLE IF NOT EXISTS person_state (
    person_name TEXT PRIMARY KEY,
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

export interface PersonState {
  personName: string;
  tier: Tier | null;
  days: number;
  firstFlaggedAt: string | null;
  lastNotifiedAt: string | null;
}

interface PersonStateRow {
  person_name: string;
  tier: Tier | null;
  days: number;
  first_flagged_at: string | null;
  last_notified_at: string | null;
}

export function loadPersonStates(): Map<string, PersonState> {
  const rows = db
    .prepare(
      `SELECT person_name, tier, days, first_flagged_at, last_notified_at FROM person_state`,
    )
    .all() as PersonStateRow[];

  return new Map(
    rows.map((r) => [
      r.person_name,
      {
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
  personName: string,
  tier: Tier | null,
  days: number,
  notifiedNow: boolean,
  now: string,
): void {
  db.prepare(
    `INSERT INTO person_state (person_name, tier, days, first_flagged_at, last_notified_at, updated_at)
     VALUES (@personName, @tier, @days, @now, @lastNotified, @now)
     ON CONFLICT(person_name) DO UPDATE SET
       tier = @tier,
       days = @days,
       first_flagged_at = COALESCE(person_state.first_flagged_at, @now),
       last_notified_at = COALESCE(@lastNotified, person_state.last_notified_at),
       updated_at = @now`,
  ).run({ personName, tier, days, now, lastNotified: notifiedNow ? now : null });
}

/** Clears tier state and records the recovery — the metric that proves impact. */
export function recordRecovery(personName: string, now: string): void {
  const state = db
    .prepare(`SELECT tier, days, first_flagged_at FROM person_state WHERE person_name = ?`)
    .get(personName) as
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
    `INSERT INTO recovery_log (person_name, tier_at_recovery, days_flagged, recovered_at)
     VALUES (?, ?, ?, ?)`,
  ).run(personName, state?.tier ?? null, daysFlagged, now);

  db.prepare(
    `UPDATE person_state SET tier = NULL, first_flagged_at = NULL, last_notified_at = NULL,
     updated_at = ? WHERE person_name = ?`,
  ).run(now, personName);
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
