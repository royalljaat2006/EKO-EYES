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
import FilterMenu from "./components/FilterMenu";
import EntityResultsPanel from "./components/EntityResultsPanel";
import type { EntityCriteria } from "./components/EntityFilterBar";
import UniversalSearchBar from "./components/UniversalSearchBar";
import LiveClock from "./components/LiveClock";
import { useTheme } from "./useTheme";
import {
  fetchAllCsps,
  fetchDeliverySummary,
  fetchInactivityData,
  fetchKpiReport,
} from "./api/client";
import type { CspRoster, DeliverySummary, InactivityQueryResult, KpiReport } from "./types";
import { RANGE_FILTER_LABELS, RANGE_OPTIONS, inRange } from "./rangeOptions";
import type { RangeFilter, RangeOption } from "./rangeOptions";

export default function App() {
  const { theme, setTheme } = useTheme();
  const [range, setRange] = useState<RangeFilter>("7-15");
  const [data, setData] = useState<InactivityQueryResult | null>(null);
  const [delivery, setDelivery] = useState<DeliverySummary | null>(null);
  const [kpi, setKpi] = useState<KpiReport | null>(null);
  const [roster, setRoster] = useState<CspRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityCriteria, setEntityCriteria] = useState<EntityCriteria | null>(null);
  const entityResultsRef = useRef<HTMLDivElement>(null);

  // The LHO/RM/DC results render inline on the page, not in a popup — scroll
  // them into view on apply so picking a filter from the menu (which can be
  // well above this section) still feels immediate.
  useEffect(() => {
    if (entityCriteria) entityResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [entityCriteria]);

  const load = useCallback(async (r: RangeFilter) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInactivityData(r);
      setData(result);
    } catch {
      setError("Could not load inactivity data. Confirm the API server is running.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKpi = useCallback((r: RangeFilter) => {
    fetchKpiReport(r)
      .then(setKpi)
      .catch(() => setKpi(null));
  }, []);

  // The table/chart data AND the KPI panel's range-trend chart both key off
  // the header filter, so both refetch whenever it changes.
  useEffect(() => {
    load(range);
    loadKpi(range);
  }, [range, load, loadKpi]);

  // Delivery history and the roster reflect the programme as a whole, not the
  // filter — but a manual run can still shift which bucket someone's in, so a
  // full refresh still needs the current range for the two that DO filter.
  const refreshAll = useCallback(() => {
    load(range);
    loadKpi(range);
    fetchDeliverySummary()
      .then(setDelivery)
      .catch(() => setDelivery(null));
    fetchAllCsps()
      .then(setRoster)
      .catch(() => setRoster(null));
  }, [range, load, loadKpi]);

  useEffect(() => {
    fetchDeliverySummary()
      .then(setDelivery)
      .catch(() => setDelivery(null));
    fetchAllCsps()
      .then(setRoster)
      .catch(() => setRoster(null));
  }, []);

  const rmCount = data ? new Set(data.records.map((r) => r.rmName)).size : 0;

  // Counts for every bucket, computed from the full roster so the KPI panel's
  // range strip can show all six side by side and highlight the active one —
  // the same buckets driving the header filter, not the escalation tiers.
  const rangeCounts = useMemo(() => {
    if (!roster) return null;
    const counts = {} as Record<RangeOption, number>;
    for (const opt of RANGE_OPTIONS) {
      counts[opt] = roster.records.filter((r) => inRange(r.days, opt)).length;
    }
    return counts;
  }, [roster]);

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
            <h1>Eko Dekho</h1>
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

      <UniversalSearchBar records={roster?.records ?? []} />

      {error && <div className="error-banner">{error}</div>}

      {loading && !data ? (
        <div className="loading-state">Loading inactivity data&hellip;</div>
      ) : (
        data && (
          <>
            {kpi && (
              <KpiPanel kpi={kpi} range={range} rangeCounts={rangeCounts} filteredCount={data.totalRecords} />
            )}

            <div className="stat-row">
              <div className="stat-tile">
                <span className="stat-tile__value">{data.totalRecords}</span>
                <span className="stat-tile__label">Inactive &middot; {RANGE_FILTER_LABELS[range]}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__value">{rmCount}</span>
                <span className="stat-tile__label">RMs affected</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__value delivery-stat__value--warn">
                  {data.unknownRecords}
                </span>
                <span className="stat-tile__label">
                  Unmeasurable &mdash; &ldquo;No transaction data&rdquo;
                </span>
              </div>
              <div className="stat-tile stat-tile--muted">
                <span className="stat-tile__value stat-tile__value--small">
                  {new Date(data.generatedAt).toLocaleString()}
                </span>
                <span className="stat-tile__label">Last refreshed</span>
              </div>
            </div>

            {entityCriteria && roster && (
              <div ref={entityResultsRef}>
                <EntityResultsPanel
                  records={roster.records}
                  criteria={entityCriteria}
                  onClear={() => setEntityCriteria(null)}
                />
              </div>
            )}

            <SummaryChart data={data.summaryByRm} thresholdLabel={RANGE_FILTER_LABELS[range]} />
            <DataTable records={data.records} thresholdLabel={RANGE_FILTER_LABELS[range]} />
            {roster && <AllCspsTable records={roster.records} />}
            {delivery && <DeliveryPanel summary={delivery} />}
            <TestDeliveryPanel />
          </>
        )
      )}
    </div>
  );
}
