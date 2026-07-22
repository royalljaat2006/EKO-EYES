import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import SummaryChart from "./components/SummaryChart";
import DataTable from "./components/DataTable";
import DeliveryPanel from "./components/DeliveryPanel";
import ThemeSwitcher from "./components/ThemeSwitcher";
import KpiPanel from "./components/KpiPanel";
import AllCspsTable from "./components/AllCspsTable";
import TriggerRunButton from "./components/TriggerRunButton";
import TestDeliveryPanel from "./components/TestDeliveryPanel";
import DailyChangesPanel from "./components/DailyChangesPanel";
import FilterMenu from "./components/FilterMenu";
import FilteredResultsPanel from "./components/FilteredResultsPanel";
import { PICK } from "./components/EntityFilterBar";
import type { EntityCriteria } from "./components/EntityFilterBar";
import UniversalSearchBar, { matchesQuery } from "./components/UniversalSearchBar";
import LiveClock from "./components/LiveClock";
import { useTheme } from "./useTheme";
import { fetchAllCsps, fetchDeliverySummary, fetchKpiReport } from "./api/client";
import type { CspRoster, DeliverySummary, InactivityRecord, KpiReport, RmGroupSummary } from "./types";
import { RANGE_FILTER_LABELS, RANGE_OPTIONS, inRangeFilterFolded, isIgnoredBucket } from "./rangeOptions";
import type { RangeFilter, RangeOption } from "./rangeOptions";
import { tierForDays } from "./tierOptions";
import type { Tier } from "./tierOptions";

function matchesEntity(r: InactivityRecord, criteria: EntityCriteria | null): boolean {
  if (!criteria) return true;
  if (criteria.lho && PICK.LHO(r).trim().toLowerCase() !== criteria.lho.key) return false;
  if (criteria.rm && PICK.RM(r).trim().toLowerCase() !== criteria.rm.key) return false;
  if (criteria.dc && PICK.DC(r).trim().toLowerCase() !== criteria.dc.key) return false;
  return true;
}

const byDaysDesc = (a: InactivityRecord, b: InactivityRecord) => (b.days ?? -1) - (a.days ?? -1);

export default function App() {
  const { theme, setTheme } = useTheme();
  const [range, setRange] = useState<RangeFilter>("7-15");
  const [entityCriteria, setEntityCriteria] = useState<EntityCriteria | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [delivery, setDelivery] = useState<DeliverySummary | null>(null);
  const [kpi, setKpi] = useState<KpiReport | null>(null);
  const [roster, setRoster] = useState<CspRoster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardDetail, setCardDetail] = useState<{ title: string; records: InactivityRecord[] } | null>(null);
  const cardDetailRef = useRef<HTMLDivElement>(null);

  // Every card-click detail renders in the SAME slot, right below the top
  // cards — scroll it into view so it's obvious something happened.
  useEffect(() => {
    if (cardDetail) cardDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [cardDetail]);

  const loadKpi = useCallback((r: RangeFilter) => {
    fetchKpiReport(r)
      .then(setKpi)
      .catch(() => setKpi(null));
  }, []);

  // The Trends graph's history is keyed by range only (that's all the daily
  // job persists per day) — refetch whenever the range changes.
  useEffect(() => {
    loadKpi(range);
  }, [range, loadKpi]);

  const refreshAll = useCallback(() => {
    loadKpi(range);
    fetchDeliverySummary()
      .then(setDelivery)
      .catch(() => setDelivery(null));
    fetchAllCsps()
      .then(setRoster)
      .catch(() => setRoster(null));
  }, [range, loadKpi]);

  useEffect(() => {
    fetchDeliverySummary()
      .then(setDelivery)
      .catch(() => setDelivery(null));
    fetchAllCsps()
      .then(setRoster)
      .catch(() => setError("Could not load CSP data. Confirm the API server is running."));
  }, []);

  // --- The single unified filter: range + LHO/RM/DC + search, combined. ---
  // Every top number, the KPI %, and the Trends graph derive from these two
  // arrays — there is no second, separate "filtered results" data set
  // anywhere else on the page.

  /** Everyone matching LHO/RM/DC + search — the population the % is measured against. Range is NOT applied here; range is what narrows within it. */
  const denominatorRecords = useMemo(() => {
    if (!roster) return [];
    const q = searchQuery.trim().toLowerCase();
    return roster.records.filter((r) => matchesEntity(r, entityCriteria) && (!q || matchesQuery(r, q)));
  }, [roster, entityCriteria, searchQuery]);

  /**
   * denominatorRecords further narrowed by the day-range bucket — this is what
   * every "Inactive" number on the page means. Under "All Days" the 90+
   * bucket (real or unmeasurable) is deliberately excluded: nobody is
   * actively working those CSPs, so they shouldn't inflate the Inactive
   * headline — they still count toward totalCount (Total CSPs) below, and
   * clicking the 90+ chip directly still reveals them.
   */
  const visibleRecords = useMemo(
    () =>
      denominatorRecords
        .filter((r) => inRangeFilterFolded(r.days, range))
        .filter((r) => range !== "all" || !isIgnoredBucket(r.days))
        .sort(byDaysDesc),
    [denominatorRecords, range],
  );

  const filteredCount = visibleRecords.length;
  const totalCount = denominatorRecords.length;
  const currentRate = totalCount > 0 ? Number(((filteredCount / totalCount) * 100).toFixed(2)) : 0;
  const onTarget = kpi ? currentRate <= kpi.targetRate : false;

  const filterLabel = useMemo(() => {
    const parts = [RANGE_FILTER_LABELS[range]];
    if (entityCriteria?.lho) parts.push(`LHO: ${entityCriteria.lho.label}`);
    if (entityCriteria?.rm) parts.push(`RM: ${entityCriteria.rm.label}`);
    if (entityCriteria?.dc) parts.push(`DC: ${entityCriteria.dc.label}`);
    if (searchQuery.trim()) parts.push(`Search: "${searchQuery.trim()}"`);
    return parts.join("  ·  ");
  }, [range, entityCriteria, searchQuery]);

  const hasSecondaryFilter = Boolean(entityCriteria || searchQuery.trim());
  const liveToday = useMemo(
    () => ({ day: new Date().toISOString().slice(0, 10), count: filteredCount }),
    [filteredCount],
  );

  const rmCount = new Set(visibleRecords.map((r) => r.rmName)).size;
  const healthyRecords = useMemo(
    () => denominatorRecords.filter((r) => r.days !== null && r.days < 3),
    [denominatorRecords],
  );

  const summaryByRm: RmGroupSummary[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of visibleRecords) {
      const key = r.rmName || "(unassigned)";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([rmName, count]) => ({ rmName, count }))
      .sort((a, b) => b.count - a.count);
  }, [visibleRecords]);

  // Every bucket's count within the current LHO/RM/DC/search population — the
  // range-strip inside KpiPanel, and what its chips filter down to on click.
  const rangeCounts = useMemo(() => {
    if (!roster) return null;
    const counts = {} as Record<RangeOption, number>;
    for (const opt of RANGE_OPTIONS) {
      counts[opt] = denominatorRecords.filter((r) => inRangeFilterFolded(r.days, opt)).length;
    }
    return counts;
  }, [roster, denominatorRecords]);

  const showFilteredDetail = () => setCardDetail({ title: filterLabel, records: visibleRecords });
  const showHealthyDetail = () =>
    setCardDetail({ title: `Healthy${hasSecondaryFilter ? `  ·  ${filterLabel}` : ""}`, records: healthyRecords });
  const showRmDetail = () => setCardDetail({ title: `RMs affected  ·  ${filterLabel}`, records: visibleRecords });
  const showTierDetail = (tier: Tier) => {
    const meta = kpi?.byTier.find((t) => t.tier === tier);
    const inTier = denominatorRecords.filter((r) => tierForDays(r.days) === tier).sort(byDaysDesc);
    setCardDetail({ title: `${meta?.label ?? tier} (${meta?.range ?? ""})`, records: inTier });
  };

  return (
    <div className="app-shell">
      <div className="top-actions">
        <FilterMenu
          range={range}
          onRangeChange={setRange}
          records={roster?.records ?? []}
          onApplyEntity={setEntityCriteria}
          onClearEntity={() => setEntityCriteria(null)}
        />
        <TriggerRunButton onComplete={refreshAll} />
      </div>
      <header className="app-header">
        <div className="app-header__brand">
          <img src="eko-logo.svg" alt="Eko" className="app-header__logo" />
          <div>
            <h1>E.Y.E.S.</h1>
            <p className="app-header__tagline">EKO Yield &amp; Escalation System</p>
            <p className="app-header__subtitle">
              Live view of the inactivity tracking spreadsheet
            </p>
          </div>
        </div>
        <div className="app-header__controls">
          <LiveClock />
          <ThemeSwitcher theme={theme} onChange={setTheme} />
        </div>
      </header>

      <UniversalSearchBar value={searchQuery} onChange={setSearchQuery} />

      {error && <div className="error-banner">{error}</div>}

      {!roster && !error ? (
        <div className="loading-state">Loading inactivity data&hellip;</div>
      ) : (
        roster && (
          <>
            {kpi && (
              <KpiPanel
                kpi={kpi}
                range={range}
                rangeCounts={rangeCounts}
                filteredCount={filteredCount}
                totalCount={totalCount}
                currentRate={currentRate}
                onTarget={onTarget}
                filterLabel={filterLabel}
                hasSecondaryFilter={hasSecondaryFilter}
                liveToday={liveToday}
                onRangeChipClick={setRange}
                onTierChipClick={showTierDetail}
                onFilteredCardClick={showFilteredDetail}
              />
            )}

            <div className="stat-row">
              <button type="button" className="stat-tile stat-tile--clickable" onClick={showHealthyDetail}>
                <span className="stat-tile__value">{healthyRecords.length}</span>
                <span className="stat-tile__label">Healthy &middot; click to view</span>
              </button>
              <button type="button" className="stat-tile stat-tile--clickable" onClick={showRmDetail}>
                <span className="stat-tile__value">{rmCount}</span>
                <span className="stat-tile__label">RMs affected &middot; click to view</span>
              </button>
              <div className="stat-tile stat-tile--muted">
                <span className="stat-tile__value stat-tile__value--small">
                  {new Date(roster.generatedAt).toLocaleString()}
                </span>
                <span className="stat-tile__label">Last refreshed</span>
              </div>
            </div>

            {cardDetail && (
              <div ref={cardDetailRef}>
                <FilteredResultsPanel
                  title={cardDetail.title}
                  records={cardDetail.records}
                  emptyMessage="No CSPs match this."
                  onClear={() => setCardDetail(null)}
                />
              </div>
            )}

            <DailyChangesPanel />

            <SummaryChart data={summaryByRm} thresholdLabel={filterLabel} />
            <DataTable records={visibleRecords} thresholdLabel={filterLabel} />
            <AllCspsTable records={roster.records} />
            {delivery && <DeliveryPanel summary={delivery} />}
            <TestDeliveryPanel />
          </>
        )
      )}
    </div>
  );
}
