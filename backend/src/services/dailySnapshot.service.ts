import db from "./alertStore.service";
import { Tier, tierForDays } from "../config/escalation";
import { InactivityRecord } from "../types";

/**
 * Yesterday's roster, frozen — the baseline every day-over-day number is
 * measured against.
 *
 * WHY THIS EXISTS (the bug it fixes): onset/recovery used to be derived by
 * comparing today's sheet against `person_state`. But `person_state` was
 * being rewritten continuously by the per-minute sheet refresh, so by the
 * time the noon job ran, "yesterday's tier" had already been overwritten
 * with today's. Every CSP therefore looked unchanged: `entered-tier` never
 * fired, `inactivity_onset_log` stayed empty for weeks, and
 * `new_breaches`/`newly_inactive` sat at 0 forever.
 *
 * The fix is to stop inferring the baseline from mutable live state and
 * store it explicitly instead: one immutable row per (day, CSP). Nothing on
 * the fast path writes here — only the daily job does, exactly once per day,
 * AFTER it has finished comparing. `person_state` still exists but is now
 * purely about notification cadence (when did we last message this person),
 * which is a different question from "what changed since yesterday".
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_roster_snapshot (
    day TEXT NOT NULL,
    csp_code TEXT NOT NULL,
    person_name TEXT NOT NULL,
    days INTEGER,
    tier TEXT,
    PRIMARY KEY (day, csp_code)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_roster_snapshot_day ON daily_roster_snapshot(day);
`);

/** One CSP as they stood at the end of a given day's run. */
export interface SnapshotEntry {
  cspCode: string;
  personName: string;
  /** null = unmeasurable ("No transaction data") — deliberately NOT zero. */
  days: number | null;
  /** null = healthy / below the 3-day early-warning floor. */
  tier: Tier | null;
}

interface SnapshotRow {
  csp_code: string;
  person_name: string;
  days: number | null;
  tier: Tier | null;
}

const toEntry = (r: SnapshotRow): SnapshotEntry => ({
  cspCode: r.csp_code,
  personName: r.person_name,
  days: r.days,
  tier: r.tier,
});

/** True when this CSP counts as inactive/flagged — i.e. sits in any escalation tier. */
export const isFlagged = (tier: Tier | null): boolean => tier !== null;

/**
 * Writes (or replaces) the snapshot for `day`. Replacing matters: a manual
 * re-trigger on the same day must not leave a half-old, half-new baseline,
 * so the day is cleared and rewritten inside one transaction.
 */
export function saveDailySnapshot(day: string, records: InactivityRecord[]): void {
  const clear = db.prepare(`DELETE FROM daily_roster_snapshot WHERE day = ?`);
  const insert = db.prepare(
    `INSERT INTO daily_roster_snapshot (day, csp_code, person_name, days, tier)
     VALUES (@day, @cspCode, @personName, @days, @tier)
     ON CONFLICT(day, csp_code) DO UPDATE SET
       person_name = @personName, days = @days, tier = @tier`,
  );

  const write = db.transaction((rows: InactivityRecord[]) => {
    clear.run(day);
    for (const r of rows) {
      // A blank CSP code can't be keyed on or compared across days — the
      // parser already treats those rows as unusable, skip them here too
      // rather than collapsing them all onto one empty-string key.
      if (!r.cspCode) continue;
      insert.run({
        day,
        cspCode: r.cspCode,
        personName: r.targetPersonName,
        days: r.days,
        tier: r.days === null ? null : (tierForDays(r.days)?.tier ?? null),
      });
    }
  });
  write(records);
}

/**
 * The baseline day to diff `day` against — the most recent snapshot that
 * exists ON OR BEFORE `day`.
 *
 * Deliberately NOT "strictly before `day`" (that was the bug): the daily job
 * is meant to run once a day, but an operator can also trigger it manually,
 * and it did — 5 times on 2026-07-29 alone. Each run diffed against
 * YESTERDAY's snapshot regardless of runs earlier that same day, so every
 * re-run re-detected the same onsets/recoveries as brand new:
 *   - the same CSP got onset-logged 5 times for one real transition
 *   - recoveries got logged twice, the second time with a NULL tier —
 *     because the FIRST run had already reset person_state.tier to NULL
 *     (recordRecovery reads person_state, not the snapshot), so the
 *     re-detected "recovery" on run 2 had nothing left to read.
 *
 * Preferring TODAY's own snapshot (if an earlier run already wrote one)
 * makes the baseline "whatever the last run observed" — today if we've
 * already run today, yesterday only on the actual first run of the day.
 * Since `saveDailySnapshot` runs LAST in the job (after this diff), at
 * diff-time "today's row" is always the previous run's data, never this
 * run's — so this can't compare a run against itself.
 */
export function previousSnapshotDay(day: string): string | null {
  const sameDay = db.prepare(`SELECT 1 FROM daily_roster_snapshot WHERE day = ? LIMIT 1`).get(day);
  if (sameDay) return day;
  const prior = db
    .prepare(`SELECT day FROM daily_roster_snapshot WHERE day < ? ORDER BY day DESC LIMIT 1`)
    .get(day) as { day: string } | undefined;
  return prior?.day ?? null;
}

/** The snapshot for `previousSnapshotDay(day)`, keyed by csp_code. Empty map when no earlier snapshot exists yet. */
export function loadPreviousSnapshot(day: string): Map<string, SnapshotEntry> {
  const priorDay = previousSnapshotDay(day);
  if (!priorDay) return new Map();

  const rows = db
    .prepare(
      `SELECT csp_code, person_name, days, tier FROM daily_roster_snapshot WHERE day = ?`,
    )
    .all(priorDay) as SnapshotRow[];

  return new Map(rows.map((r) => [r.csp_code, toEntry(r)]));
}

export function snapshotDayCount(): number {
  const row = db
    .prepare(`SELECT COUNT(DISTINCT day) AS c FROM daily_roster_snapshot`)
    .get() as { c: number };
  return row.c;
}

export interface RosterDiff {
  /** The snapshot day this was measured against, or null on the very first run. */
  comparedTo: string | null;
  /** Was healthy (or unmeasurable) yesterday, is flagged today — a REAL transition. */
  newlyInactive: { record: InactivityRecord; tier: Tier; previousDays: number | null }[];
  /** Not in yesterday's snapshot at all AND flagged today — a roster addition, not a transition. Reported separately so it never inflates the transition count. */
  newCspsAdded: { record: InactivityRecord; tier: Tier }[];
  /** Was flagged yesterday, is no longer flagged today (and is still on the roster). */
  recovered: { record: InactivityRecord; previousTier: Tier; previousDays: number | null }[];
  /** Was flagged yesterday and has vanished from the sheet entirely — NOT counted as a recovery, since we can't tell whether they recovered or were simply removed. */
  droppedWhileFlagged: SnapshotEntry[];
}

/**
 * The day-over-day comparison, in one place.
 *
 * The distinction the caller cares about most: someone who *crossed* from
 * healthy into a tier (a real behavioural change worth alerting and counting)
 * versus someone who merely *appeared* in the sheet already inactive (a data
 * event — nothing changed about them, we just started seeing them). Lumping
 * the second into "newly inactive today" makes a roster import look like a
 * mass outbreak, so they're returned as their own list.
 *
 * On the very first run there is no prior snapshot. Everything is then
 * reported as empty rather than treating all 500-odd CSPs as brand-new
 * onsets — a one-time honest "we don't know yet" instead of a fabricated
 * spike. `comparedTo` is null so the caller can say so explicitly.
 */
export function diffRoster(
  today: InactivityRecord[],
  day: string,
): RosterDiff {
  const comparedTo = previousSnapshotDay(day);
  const empty: RosterDiff = {
    comparedTo,
    newlyInactive: [],
    newCspsAdded: [],
    recovered: [],
    droppedWhileFlagged: [],
  };
  if (comparedTo === null) return empty;

  const prev = loadPreviousSnapshot(day);
  const diff: RosterDiff = { ...empty, newlyInactive: [], newCspsAdded: [], recovered: [], droppedWhileFlagged: [] };
  const seenToday = new Set<string>();

  for (const record of today) {
    if (!record.cspCode) continue;
    seenToday.add(record.cspCode);

    const tier = record.days === null ? null : (tierForDays(record.days)?.tier ?? null);
    const before = prev.get(record.cspCode);

    if (!before) {
      // Brand new to the roster. Only interesting if they arrive already flagged.
      if (tier !== null) diff.newCspsAdded.push({ record, tier });
      continue;
    }

    const wasFlagged = isFlagged(before.tier);
    const isNowFlagged = tier !== null;

    if (!wasFlagged && isNowFlagged) {
      diff.newlyInactive.push({ record, tier: tier!, previousDays: before.days });
    } else if (wasFlagged && !isNowFlagged) {
      diff.recovered.push({ record, previousTier: before.tier!, previousDays: before.days });
    }
  }

  // Flagged yesterday, gone from the sheet today. Treating this as a recovery
  // would credit the alerting for someone who may simply have been deleted or
  // transferred, so it's tracked on its own for a human to interpret.
  for (const [cspCode, before] of prev) {
    if (!seenToday.has(cspCode) && isFlagged(before.tier)) {
      diff.droppedWhileFlagged.push(before);
    }
  }

  return diff;
}
