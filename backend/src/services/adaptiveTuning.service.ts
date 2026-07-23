import db from "./alertStore.service";
import env from "../config/env";
import logger from "../utils/logger";

/**
 * A bounded, auditable feedback loop over the system's own history — each
 * daily run looks back at how many nudges CSPs had already received when
 * they recovered, and adjusts the CSP_MAX_NUDGES cap by at most ONE step
 * within a fixed safety range. Every evaluation, including a "no change"
 * one, is written to tuning_adjustments so the reasoning is always
 * inspectable from the dashboard — never a silent parameter change.
 *
 * Deliberately NOT self-modifying code: it tunes one numeric runtime
 * parameter, clamped to [MIN_CAP, MAX_CAP], rate-limited to one step per
 * day, and fully logged. See SKILLS.md.
 */

const PARAM = "CSP_MAX_NUDGES";
const MIN_CAP = 2;
const MAX_CAP = 6;
const LOOKBACK_DAYS = 30;
const MIN_SAMPLE = 8;
/** Share of recoveries landing right at the cap that suggests it's cutting people off too early. */
const NEAR_CAP_SHARE_THRESHOLD = 0.5;
/** Share of recoveries landing in the first nudge or two that suggests later nudges rarely help. */
const EARLY_SHARE_THRESHOLD = 0.7;

db.exec(`
  CREATE TABLE IF NOT EXISTS tuning_state (
    param TEXT PRIMARY KEY,
    value INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tuning_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    param TEXT NOT NULL,
    old_value INTEGER NOT NULL,
    new_value INTEGER NOT NULL,
    sample_size INTEGER NOT NULL,
    near_cap_share REAL,
    early_share REAL,
    reason TEXT NOT NULL,
    evaluated_at TEXT NOT NULL
  );
`);

export interface TuningEvaluation {
  id: number;
  param: string;
  oldValue: number;
  newValue: number;
  sampleSize: number;
  nearCapShare: number | null;
  earlyShare: number | null;
  reason: string;
  evaluatedAt: string;
}

export interface TuningReport {
  param: string;
  currentValue: number;
  bounds: [number, number];
  defaultValue: number;
  history: TuningEvaluation[];
}

/** The cap decideNudge should actually use right now — env.CSP_MAX_NUDGES until tuning has run at least once. */
export function getEffectiveMaxNudges(): number {
  const row = db.prepare(`SELECT value FROM tuning_state WHERE param = ?`).get(PARAM) as
    | { value: number }
    | undefined;
  return row?.value ?? env.CSP_MAX_NUDGES;
}

function setMaxNudges(value: number, now: string): void {
  db.prepare(
    `INSERT INTO tuning_state (param, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(param) DO UPDATE SET value = ?, updated_at = ?`,
  ).run(PARAM, value, now, value, now);
}

function clamp(v: number): number {
  return Math.min(MAX_CAP, Math.max(MIN_CAP, v));
}

/**
 * Runs once per daily job, before today's nudges are decided, so any
 * adjustment takes effect the same day. Reads recovery_log rows from the
 * last LOOKBACK_DAYS with a known nudge_count_at_recovery and moves the cap
 * by at most one step:
 *  - Most recoveries land right at the cap -> it may be cutting off people
 *    who'd have come back with one more nudge -> raise it by 1.
 *  - Most recoveries happen within the first nudge or two -> further nudges
 *    rarely help -> lower it by 1 so non-responders reach a human call
 *    sooner instead of being nagged.
 *  - Otherwise, or without enough data yet -> leave it alone.
 */
export function runAdaptiveTuning(now: string = new Date().toISOString()): TuningEvaluation {
  const currentCap = getEffectiveMaxNudges();

  const rows = db
    .prepare(
      `SELECT nudge_count_at_recovery AS n FROM recovery_log
       WHERE recovered_at >= datetime('now', ?) AND nudge_count_at_recovery IS NOT NULL`,
    )
    .all(`-${LOOKBACK_DAYS} days`) as { n: number }[];

  const sampleSize = rows.length;
  let nearCapShare: number | null = null;
  let earlyShare: number | null = null;
  let newValue = currentCap;
  let reason: string;

  if (sampleSize < MIN_SAMPLE) {
    reason = `Only ${sampleSize} recoveries with a known nudge count in the last ${LOOKBACK_DAYS} days (need ${MIN_SAMPLE}+) — leaving the cap at ${currentCap}.`;
  } else {
    const nearCap = rows.filter((r) => r.n >= currentCap).length;
    const early = rows.filter((r) => r.n <= 1).length;
    nearCapShare = Number((nearCap / sampleSize).toFixed(2));
    earlyShare = Number((early / sampleSize).toFixed(2));

    if (nearCapShare >= NEAR_CAP_SHARE_THRESHOLD && currentCap < MAX_CAP) {
      newValue = clamp(currentCap + 1);
      reason = `${Math.round(nearCapShare * 100)}% of recent recoveries happened right at the ${currentCap}-nudge cap — raising it to ${newValue} to see if one more nudge converts holdouts.`;
    } else if (earlyShare >= EARLY_SHARE_THRESHOLD && currentCap > MIN_CAP) {
      newValue = clamp(currentCap - 1);
      reason = `${Math.round(earlyShare * 100)}% of recent recoveries happened within the first nudge or two — lowering the cap to ${newValue} so non-responders reach a human call sooner instead of being nagged.`;
    } else {
      reason = `${Math.round((nearCapShare ?? 0) * 100)}% recovered at the cap, ${Math.round((earlyShare ?? 0) * 100)}% recovered early — neither threshold crossed, cap stays at ${currentCap}.`;
    }
  }

  if (newValue !== currentCap) {
    setMaxNudges(newValue, now);
    logger.info(
      { param: PARAM, from: currentCap, to: newValue, sampleSize },
      "Adaptive tuning adjusted a parameter",
    );
  }

  const info = db
    .prepare(
      `INSERT INTO tuning_adjustments
         (param, old_value, new_value, sample_size, near_cap_share, early_share, reason, evaluated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(PARAM, currentCap, newValue, sampleSize, nearCapShare, earlyShare, reason, now);

  return {
    id: Number(info.lastInsertRowid),
    param: PARAM,
    oldValue: currentCap,
    newValue,
    sampleSize,
    nearCapShare,
    earlyShare,
    reason,
    evaluatedAt: now,
  };
}

export function getTuningReport(limit = 20): TuningReport {
  const rows = db
    .prepare(
      `SELECT id, param, old_value, new_value, sample_size, near_cap_share, early_share, reason, evaluated_at
       FROM tuning_adjustments WHERE param = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(PARAM, limit) as {
    id: number;
    param: string;
    old_value: number;
    new_value: number;
    sample_size: number;
    near_cap_share: number | null;
    early_share: number | null;
    reason: string;
    evaluated_at: string;
  }[];

  return {
    param: PARAM,
    currentValue: getEffectiveMaxNudges(),
    bounds: [MIN_CAP, MAX_CAP],
    defaultValue: env.CSP_MAX_NUDGES,
    history: rows.map((r) => ({
      id: r.id,
      param: r.param,
      oldValue: r.old_value,
      newValue: r.new_value,
      sampleSize: r.sample_size,
      nearCapShare: r.near_cap_share,
      earlyShare: r.early_share,
      reason: r.reason,
      evaluatedAt: r.evaluated_at,
    })),
  };
}
