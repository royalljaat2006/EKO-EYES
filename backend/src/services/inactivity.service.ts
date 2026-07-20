import { InactivityQueryResult, InactivityRecord, RmGroupSummary } from "../types";
import { fetchRecords } from "./dataSource.service";
import { inRangeFilter, RangeFilter } from "../config/inactivityRanges";

/** Records whose inactivity is known. Unknowns ("No transaction data") are excluded. */
export function known(records: InactivityRecord[]): (InactivityRecord & { days: number })[] {
  return records.filter((r): r is InactivityRecord & { days: number } => r.days !== null);
}

export function unknownCount(records: InactivityRecord[]): number {
  return records.filter((r) => r.days === null).length;
}

/** A discrete inactivity-day bucket, or "all" for every bucket combined — see config/inactivityRanges.ts. */
export function filterByRange(
  records: InactivityRecord[],
  range: RangeFilter,
): InactivityRecord[] {
  return known(records).filter((r) => inRangeFilter(r.days, range));
}

/** Strictly greater than — used for the alerting pipeline, per the original spec. */
export function filterAlertCandidates(
  records: InactivityRecord[],
  threshold: number,
): InactivityRecord[] {
  return known(records).filter((r) => r.days > threshold);
}

export function groupByRm(records: InactivityRecord[]): RmGroupSummary[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const key = r.rmName || "(unassigned)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([rmName, count]) => ({ rmName, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getInactivityDashboardData(
  range: RangeFilter,
): Promise<InactivityQueryResult> {
  const all = await fetchRecords();
  const filtered = filterByRange(all, range);
  return {
    range,
    generatedAt: new Date().toISOString(),
    totalRecords: filtered.length,
    unknownRecords: unknownCount(all),
    summaryByRm: groupByRm(filtered),
    records: filtered.sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
  };
}
