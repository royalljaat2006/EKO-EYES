import { TIERS, tierForDays } from "../config/escalation";
import { ALL_RANGES, inRangeFilter, RANGE_OPTIONS, RangeFilter } from "../config/inactivityRanges";
import { InactivityRecord, KpiReport, KpiSnapshot } from "../types";
import { fetchRecords } from "./dataSource.service";
import { known, unknownCount } from "./inactivity.service";
import { countRecoveries, getKpiTrend } from "./stateStore.service";
import { CspEngagement, decideNudge, loadEngagements } from "./cspEngagement.service";
import { getNumberSetting } from "./settings.service";

/** Every bucket's count for that day, summed — the "all ranges" trend point. */
function sumRangeCounts(rangeCounts: KpiSnapshot["rangeCounts"]): number | null {
  if (!rangeCounts) return null;
  let total = 0;
  for (const opt of RANGE_OPTIONS) {
    const v = rangeCounts[opt];
    if (v === undefined) return null; // partial row — don't fake a total
    total += v;
  }
  return total;
}

export function computeRate(inactive: number, total: number): number {
  if (total === 0) return 0;
  return Number(((inactive / total) * 100).toFixed(2));
}

export function summarizeTiers(records: InactivityRecord[]) {
  return TIERS.map((policy) => ({
    tier: policy.tier,
    label: policy.label,
    range: policy.maxDays === null ? `${policy.minDays}+d` : `${policy.minDays}–${policy.maxDays}d`,
    count: known(records).filter((r) => tierForDays(r.days)?.tier === policy.tier).length,
  }));
}

/**
 * "Non Responsive" — currently-tiered CSPs decideNudge would refuse to
 * message again: nudge cap exhausted, or they explicitly asked us to stop.
 * Reuses the real guardrail decision, not a separate heuristic, so this
 * number always agrees with what the daily job actually does.
 */
function isNonResponsive(r: InactivityRecord, engagements: Map<string, CspEngagement>): boolean {
  if (r.days === null || tierForDays(r.days) === null) return false;
  const decision = decideNudge(r, engagements.get(r.cspCode));
  return decision === "nudge-cap-reached" || decision === "suppressed-by-reply";
}

export function countNonResponsive(records: InactivityRecord[]): number {
  const engagements = loadEngagements();
  return known(records).filter((r) => isNonResponsive(r, engagements)).length;
}

export function listNonResponsive(records: InactivityRecord[]): InactivityRecord[] {
  const engagements = loadEngagements();
  return known(records)
    .filter((r) => isNonResponsive(r, engagements))
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
}

export async function getKpiReport(range?: RangeFilter): Promise<KpiReport> {
  const records = await fetchRecords();
  const measurable = known(records);
  // The rate is measured over rows we can actually measure. Unknowns are
  // reported alongside it rather than folded in as healthy.
  const total = measurable.length;

  const inactive = measurable.filter((r) => r.days > getNumberSetting("inactivityThresholdDays"));
  const atRisk = measurable.filter((r) => tierForDays(r.days)?.tier === "self");

  const trend = getKpiTrend(30);
  const recoveries = countRecoveries(30);
  const currentRate = computeRate(inactive.length, total);
  const today = new Date().toISOString().slice(0, 10);

  // The trend the range-filter dashboard chart plots. Historical days come from
  // the daily job's stored snapshot (only present from when this was added —
  // older rows have no rangeCounts and are skipped rather than shown as zero,
  // which would misleadingly look like a real drop to nothing). Today's point
  // is always computed live from the current sheet, even before the daily job
  // has run, so switching the filter feels immediate rather than stale.
  const rangeTrend: { day: string; count: number }[] = range
    ? [
        ...trend
          .filter((s) => s.day !== today)
          .map((s) => ({
            day: s.day,
            count: range === ALL_RANGES ? sumRangeCounts(s.rangeCounts) : (s.rangeCounts?.[range] ?? null),
          }))
          .filter((s): s is { day: string; count: number } => s.count !== null),
        { day: today, count: measurable.filter((r) => inRangeFilter(r.days, range)).length },
      ]
    : [];

  const targetRate = getNumberSetting("targetInactivityRate");

  return {
    targetRate,
    currentRate,
    currentInactive: inactive.length,
    totalPeople: total,
    unknownPeople: unknownCount(records),
    atRisk: atRisk.length,
    nonResponsive: countNonResponsive(records),
    recoveries,
    newBreaches: trend.reduce((sum, s) => sum + s.newBreaches, 0),
    recoveryRate:
      recoveries + inactive.length === 0
        ? 0
        : Number(((recoveries / (recoveries + inactive.length)) * 100).toFixed(1)),
    onTarget: currentRate <= targetRate,
    trend,
    byTier: summarizeTiers(records),
    rangeTrend,
  };
}
