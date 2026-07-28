import { InactivityRecord } from "../types";
import { getRecentRecoveries } from "./stateStore.service";

/**
 * Ops-analytics layer beyond the core KPI report: geographic breakdown
 * (state/district) and per-RM/DC recovery performance. Pure arithmetic over
 * data already collected (the roster + recovery_log) — no AI/LLM involved,
 * matching what was scoped for this pass. See SKILLS.md.
 */

/** Same threshold as the dashboard's "ignored" convention: 90+/unmeasurable don't count as actionable-inactive. */
function isActionableInactive(days: number | null): boolean {
  return days !== null && days >= 3 && days < 90;
}

export interface GeoBucket {
  /** Case-insensitive dedupe key — the sheet has the same place spelled with different casing. */
  key: string;
  /** Original casing, as it first appeared in the sheet. */
  label: string;
  total: number;
  inactive: number;
  rate: number;
}

function groupByGeo(records: InactivityRecord[], pick: (r: InactivityRecord) => string): GeoBucket[] {
  const byKey = new Map<string, { label: string; total: number; inactive: number }>();
  for (const r of records) {
    const raw = pick(r).trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const bucket = byKey.get(key) ?? { label: raw, total: 0, inactive: 0 };
    bucket.total += 1;
    if (isActionableInactive(r.days)) bucket.inactive += 1;
    byKey.set(key, bucket);
  }
  return Array.from(byKey.entries())
    .map(([key, b]) => ({
      key,
      label: b.label,
      total: b.total,
      inactive: b.inactive,
      rate: b.total === 0 ? 0 : Number(((b.inactive / b.total) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.rate - a.rate || b.inactive - a.inactive);
}

export interface GeoBreakdown {
  states: GeoBucket[];
  districts: GeoBucket[];
}

export function getGeoBreakdown(records: InactivityRecord[]): GeoBreakdown {
  return {
    states: groupByGeo(records, (r) => r.state),
    districts: groupByGeo(records, (r) => r.district),
  };
}

export interface PerformanceEntry {
  key: string;
  label: string;
  /** Currently inactive (actionable, 3-89d) CSPs assigned to them right now. */
  currentlyInactive: number;
  /** Recoveries attributed to them in the trailing window. */
  recovered: number;
  /** Average days-flagged-before-recovery across those recoveries; null with no data yet. */
  avgRecoveryDays: number | null;
  /** recovered / (recovered + currentlyInactive) * 100 — same recipe as the global recoveryRate, scoped to this RM/DC. */
  efficiency: number;
}

function groupPerformance(
  records: InactivityRecord[],
  recoveries: { name: string | null; daysFlagged: number | null }[],
  pick: (r: InactivityRecord) => string,
): PerformanceEntry[] {
  const byKey = new Map<string, { label: string; currentlyInactive: number; recovered: number; daysSum: number; daysCount: number }>();

  for (const r of records) {
    if (!isActionableInactive(r.days)) continue;
    const raw = pick(r).trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const bucket = byKey.get(key) ?? { label: raw, currentlyInactive: 0, recovered: 0, daysSum: 0, daysCount: 0 };
    bucket.currentlyInactive += 1;
    byKey.set(key, bucket);
  }

  for (const rec of recoveries) {
    const raw = rec.name?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const bucket = byKey.get(key) ?? { label: raw, currentlyInactive: 0, recovered: 0, daysSum: 0, daysCount: 0 };
    bucket.recovered += 1;
    if (rec.daysFlagged !== null) {
      bucket.daysSum += rec.daysFlagged;
      bucket.daysCount += 1;
    }
    byKey.set(key, bucket);
  }

  return Array.from(byKey.entries())
    .map(([key, b]) => {
      const denom = b.recovered + b.currentlyInactive;
      return {
        key,
        label: b.label,
        currentlyInactive: b.currentlyInactive,
        recovered: b.recovered,
        avgRecoveryDays: b.daysCount === 0 ? null : Number((b.daysSum / b.daysCount).toFixed(1)),
        efficiency: denom === 0 ? 0 : Number(((b.recovered / denom) * 100).toFixed(1)),
      };
    })
    .sort((a, b) => b.currentlyInactive - a.currentlyInactive || b.recovered - a.recovered);
}

export interface RmDcPerformance {
  rm: PerformanceEntry[];
  dc: PerformanceEntry[];
}

export function getRmDcPerformance(records: InactivityRecord[], sinceDays = 30): RmDcPerformance {
  const recoveries = getRecentRecoveries(sinceDays);
  return {
    rm: groupPerformance(
      records,
      recoveries.map((r) => ({ name: r.rmName, daysFlagged: r.daysFlagged })),
      (r) => r.rmName,
    ),
    dc: groupPerformance(
      records,
      recoveries.map((r) => ({ name: r.dcName, daysFlagged: r.daysFlagged })),
      (r) => r.dcName,
    ),
  };
}
