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
import AdaptiveTuningPanel from "./components/AdaptiveTuningPanel";
import SettingsPanel from "./components/SettingsPanel";
import TemplatesPanel from "./components/TemplatesPanel";
import MessageReachPanel from "./components/MessageReachPanel";
import EmailDraftsPanel from "./components/EmailDraftsPanel";
import GeoHeatMap from "./components/GeoHeatMap";
import RmDcPerformancePanel from "./components/RmDcPerformancePanel";
import TopCriticalPanel from "./components/TopCriticalPanel";
import DailySummaryPanel from "./components/DailySummaryPanel";
import RecommendationsPanel from "./components/RecommendationsPanel";
import AtRiskPanel from "./components/AtRiskPanel";
import Panel from "./components/Panel";
import FilteredResultsPanel from "./components/FilteredResultsPanel";
import { PICK } from "./components/EntityFilterBar";
import type { EntityCriteria } from "./components/EntityFilterBar";
import { matchesQuery } from "./components/UniversalSearchBar";
import type { WorkspaceTab } from "./components/WorkspaceTabs";
import type { QuickFilterId } from "./components/QuickFilterBar";
import { useTheme } from "./useTheme";
import {
  fetchAllCsps,
  fetchAtRisk,
  fetchDailyChanges,
  fetchDeliverySummary,
  fetchKpiReport,
  fetchNonResponsive,
  fetchSettings,
} from "./api/client";
import type {
  AppSettings,
  AtRiskEntry,
  CspRoster,
  DailyChanges,
  DeliverySummary,
  InactivityRecord,
  KpiReport,
  RmGroupSummary,
} from "./types";
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

/** Maps a list that only carries cspCode (AtRiskEntry, DailyChanges onset entries) back to the full roster record for display. */
function toFullRecords(codes: string[], byCode: Map<string, InactivityRecord>): InactivityRecord[] {
  const out: InactivityRecord[] = [];
  for (const code of codes) {
    const r = byCode.get(code);
    if (r) out.push(r);
  }
  return out;
}

function getSparklineData(trendData: { day: string; count?: number }[] | undefined): string {
  if (!trendData || trendData.length < 2) {
    return "M 0 15 Q 20 5, 40 25 T 80 10";
  }
  const counts = trendData.map((d) => d.count ?? 0);
  const maxVal = Math.max(...counts);
  const minVal = Math.min(...counts);
  const range = maxVal - minVal || 1;
  const width = 80;
  const height = 30;
  const points = trendData.map((d, index) => {
    const x = (index / (trendData.length - 1)) * width;
    const y = height - (((d.count ?? 0) - minVal) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M ${points.join(" L ")}`;
}

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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [daysSliderValue, setDaysSliderValue] = useState(14);
  // Mirrored at the shell level purely so a switched-off channel is visible
  // from every tab — an operator should not have to open Alerts to discover
  // that nothing has been going out. SettingsPanel owns editing; this is a
  // read-only copy it refreshes on save.
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Fetched once up front (not just on click) so the executive ticker and
  // quick filters can combine them synchronously — same data the
  // Non-Responsive tile / At-Risk panel / Today's Changes panel show.
  const [nonResponsiveRecords, setNonResponsiveRecords] = useState<InactivityRecord[]>([]);
  const [atRiskEntries, setAtRiskEntries] = useState<AtRiskEntry[]>([]);
  const [dailyChanges, setDailyChanges] = useState<DailyChanges | null>(null);

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

  const loadExtras = useCallback(() => {
    fetchNonResponsive()
      .then(setNonResponsiveRecords)
      .catch(() => setNonResponsiveRecords([]));
    fetchAtRisk()
      .then(setAtRiskEntries)
      .catch(() => setAtRiskEntries([]));
    fetchDailyChanges()
      .then(setDailyChanges)
      .catch(() => setDailyChanges(null));
  }, []);

  // The Trends graph's history is keyed by range only (that's all the daily
  // job persists per day) — refetch whenever the range changes.
  useEffect(() => {
    loadKpi(range);
  }, [range, loadKpi]);

  const refreshAll = useCallback(() => {
    loadKpi(range);
    loadExtras();
    fetchDeliverySummary()
      .then(setDelivery)
      .catch(() => setDelivery(null));
    fetchAllCsps()
      .then(setRoster)
      .catch(() => setRoster(null));
  }, [range, loadKpi, loadExtras]);

  useEffect(() => {
    loadExtras();
    fetchSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
    fetchDeliverySummary()
      .then(setDelivery)
      .catch(() => setDelivery(null));
    fetchAllCsps()
      .then(setRoster)
      .catch(() => setError("Could not load CSP data. Confirm the API server is running."));
  }, [loadExtras]);

  /** Which channels an operator has switched off — surfaced on every tab, since the effect (nothing sends) is global. */
  const disabledChannels = useMemo(() => {
    if (!settings) return [];
    const off: string[] = [];
    if (!settings.whatsappEnabled) off.push("WhatsApp");
    if (!settings.emailEnabled) off.push("Email");
    return off;
  }, [settings]);

  // Extract unique Region (LHO) options for horizontal dropdown
  const lhoOptions = useMemo(() => {
    if (!roster) return [];
    const byKey = new Map<string, { key: string; label: string }>();
    for (const r of roster.records) {
      const label = r.lhoName?.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { key, label });
    }
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [roster]);

  // Extract unique RM options for horizontal dropdown
  const rmOptions = useMemo(() => {
    if (!roster) return [];
    const byKey = new Map<string, { key: string; label: string }>();
    for (const r of roster.records) {
      const label = r.rmName?.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, { key, label });
    }
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [roster]);

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
  const visibleRecords = useMemo(() => {
    return denominatorRecords
      .filter((r) => {
        if (range === "all") {
          return r.days !== null && r.days >= daysSliderValue && !isIgnoredBucket(r.days);
        }
        return inRangeFilterFolded(r.days, range);
      })
      .sort(byDaysDesc);
  }, [denominatorRecords, range, daysSliderValue]);

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

  const criticalRecords = useMemo(
    () => denominatorRecords.filter((r) => tierForDays(r.days) === "critical").sort(byDaysDesc),
    [denominatorRecords],
  );

  /**
   * Real point-change in the inactivity rate: today's live rate vs. the most
   * recently STORED day before today (kpi.trend is oldest-first, one row per
   * real daily-job run). null until at least one prior day exists — the KPI
   * card then shows no delta rather than a fabricated one.
   */
  const rateDelta = useMemo(() => {
    if (!kpi || kpi.trend.length === 0) return null;
    const todayStr = new Date().toISOString().slice(0, 10);
    const priorDays = kpi.trend.filter((t) => t.day !== todayStr);
    if (priorDays.length === 0) return null;
    const mostRecentPrior = priorDays[priorDays.length - 1];
    return Number((currentRate - mostRecentPrior.inactivityRate).toFixed(2));
  }, [kpi, currentRate]);

  /** Today's REAL onset/recovery counts, from the same named audit trail the Daily Changes panel shows — not invented numbers. */
  const newOnsetsToday = dailyChanges?.newlyInactive.length ?? 0;
  const recoveredToday = dailyChanges?.recovered.length ?? 0;
  const escalatedOnsetsToday = useMemo(
    () => (dailyChanges?.newlyInactive ?? []).filter((e) => e.tier === "escalated" || e.tier === "critical").length,
    [dailyChanges],
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

  // At-risk / today's-onset entries only carry a cspCode — map them back to
  // full roster records so they can render in the same FilteredResultsPanel
  // as everything else.
  const recordsByCode = useMemo(() => {
    if (!roster) return new Map<string, InactivityRecord>();
    return new Map(roster.records.map((r) => [r.cspCode, r]));
  }, [roster]);

  const atRiskAsRecords = useMemo(
    () => toFullRecords(atRiskEntries.map((e) => e.cspCode), recordsByCode),
    [atRiskEntries, recordsByCode],
  );

  const todayOnsetAsRecords = useMemo(
    () => (dailyChanges ? toFullRecords(dailyChanges.newlyInactive.map((e) => e.cspCode), recordsByCode) : []),
    [dailyChanges, recordsByCode],
  );

  /** Union of today's new onsets + non-responsive + critical, deduped by cspCode — the "Need Attention Today" quick filter. */
  const needsAttentionToday = useMemo(() => {
    const byCode = new Map<string, InactivityRecord>();
    for (const r of [...todayOnsetAsRecords, ...nonResponsiveRecords, ...criticalRecords]) {
      byCode.set(r.cspCode, r);
    }
    return Array.from(byCode.values()).sort(byDaysDesc);
  }, [todayOnsetAsRecords, nonResponsiveRecords, criticalRecords]);

  const showFilteredDetail = () => setCardDetail({ title: filterLabel, records: visibleRecords });
  const showRmDetail = () => setCardDetail({ title: `RMs affected  ·  ${filterLabel}`, records: visibleRecords });
  const showTierDetail = (tier: Tier) => {
    const meta = kpi?.byTier.find((t) => t.tier === tier);
    const inTier = denominatorRecords.filter((r) => tierForDays(r.days) === tier).sort(byDaysDesc);
    setCardDetail({ title: meta?.range ?? tier, records: inTier });
  };

  // Extract critical feed for the right sidebar (top 4 critical inactive CSPs)
  const criticalFeed = useMemo(() => {
    return denominatorRecords
      .filter((r) => r.days !== null && r.days >= 7)
      .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
      .slice(0, 4);
  }, [denominatorRecords]);

  // Extract RM leaderboard for the right sidebar
  const rmLeaderboard = useMemo(() => {
    const rmMap = new Map<string, { totalDays: number; count: number }>();
    for (const r of visibleRecords) {
      if (!r.rmName) continue;
      const entry = rmMap.get(r.rmName) || { totalDays: 0, count: 0 };
      entry.totalDays += r.days || 0;
      entry.count += 1;
      rmMap.set(r.rmName, entry);
    }
    return Array.from(rmMap.entries())
      .map(([name, val]) => ({
        name,
        avgDays: (val.totalDays / val.count).toFixed(1),
        count: val.count
      }))
      .sort((a, b) => parseFloat(a.avgDays) - parseFloat(b.avgDays))
      .slice(0, 4);
  }, [visibleRecords]);

  // Sync range change with the range-slider value
  const handleRangeChange = (r: RangeFilter) => {
    setRange(r);
    if (r === "all") setDaysSliderValue(3);
    else if (r === "3-7") setDaysSliderValue(3);
    else if (r === "7-15") setDaysSliderValue(7);
    else if (r === "15-30") setDaysSliderValue(15);
    else if (r === "30-60") setDaysSliderValue(30);
    else if (r === "60-90") setDaysSliderValue(60);
    else if (r === "90+") setDaysSliderValue(90);
  };

  // Sync range-slider change with the range filter
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setDaysSliderValue(val);
    if (val >= 90) setRange("90+");
    else if (val >= 60) setRange("60-90");
    else if (val >= 30) setRange("30-60");
    else if (val >= 15) setRange("15-30");
    else if (val >= 7) setRange("7-15");
    else if (val >= 3) setRange("3-7");
    else setRange("all");
  };

  // Handle Region (LHO) change from horizontal toolbar select
  const handleRegionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const matched = lhoOptions.find((o) => o.key === val) ?? null;
    setEntityCriteria((prev) => ({
      lho: matched,
      rm: prev?.rm ?? null,
      dc: prev?.dc ?? null,
    }));
  };

  // Handle RM Group change from horizontal toolbar select
  const handleRmChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const matched = rmOptions.find((o) => o.key === val) ?? null;
    setEntityCriteria((prev) => ({
      lho: prev?.lho ?? null,
      rm: matched,
      dc: prev?.dc ?? null,
    }));
  };

  const handleQuickFilter = (id: QuickFilterId) => {
    if (id === "all") {
      setRange("all");
      setEntityCriteria(null);
      setSearchQuery("");
      setCardDetail(null);
      return;
    }
    if (id === "needsAttention") {
      setCardDetail({ title: "Need Attention Today", records: needsAttentionToday });
    } else if (id === "nonResponsive") {
      setCardDetail({ title: "Non Responsive", records: nonResponsiveRecords });
    } else if (id === "topCritical") {
      setCardDetail({ title: "Top Critical", records: criticalRecords });
    } else if (id === "atRiskRelapses") {
      setCardDetail({ title: "At-Risk Relapses", records: atRiskAsRecords });
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <img src="eko-logo.svg" alt="Eko" className="app-header__logo" />
          <div>
            <h1>E.Y.E.S.</h1>
            <p className="app-header__tagline">EKO Yield &amp; Escalation System</p>
          </div>
        </div>

        <ul className="app-header__nav-list">
          <li>
            <button
              type="button"
              className={`app-header__nav-btn${activeTab === "overview" ? " app-header__nav-btn--active" : ""}`}
              onClick={() => {
                setActiveTab("overview");
                setCardDetail(null);
              }}
            >
              Dashboard
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`app-header__nav-btn${activeTab === "insights" ? " app-header__nav-btn--active" : ""}`}
              onClick={() => {
                setActiveTab("insights");
                setCardDetail(null);
              }}
            >
              Analysis
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`app-header__nav-btn${activeTab === "system" ? " app-header__nav-btn--active" : ""}`}
              onClick={() => {
                setActiveTab("system");
                setCardDetail(null);
              }}
            >
              Alerts
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`app-header__nav-btn${activeTab === "analytics" ? " app-header__nav-btn--active" : ""}`}
              onClick={() => {
                setActiveTab("analytics");
                setCardDetail(null);
              }}
            >
              Reports
            </button>
          </li>
        </ul>

        <div className="app-header__right-controls">
          <button
            type="button"
            className="app-header__icon-trigger app-header__bell-wrapper"
            title="Active alerts needing attention"
            onClick={() => handleQuickFilter("needsAttention")}
          >
            🔔
            {needsAttentionToday.length > 0 && <span className="app-header__bell-badge" />}
          </button>

          <ThemeSwitcher theme={theme} onChange={setTheme} />

          <div className="app-header__profile">
            <div className="avatar-circle" style={{ background: "var(--series-1)", color: "#ffffff", fontSize: "12px" }}>
              AS
            </div>
            <div className="profile-info">
              <span className="profile-name">A. Sharma</span>
              <span className="profile-role">Admin</span>
            </div>
            <span className="profile-arrow">▼</span>
          </div>
        </div>
      </header>

      {/* Glassmorphic Horizontal Filter Bar */}
      <div className="glass-filter-bar">
        <div className="glass-filter-item">
          <span className="glass-filter-label">Date Range</span>
          <select
            value={range}
            onChange={(e) => handleRangeChange(e.target.value as RangeFilter)}
            className="glass-select"
          >
            <option value="all">All Days</option>
            <option value="3-7">3-7 Days</option>
            <option value="7-15">7-15 Days</option>
            <option value="15-30">15-30 Days</option>
            <option value="30-60">30-60 Days</option>
            <option value="60-90">60-90 Days</option>
            <option value="90+">90+ Days</option>
          </select>
        </div>

        <div className="glass-filter-item">
          <span className="glass-filter-label">Region</span>
          <select
            value={entityCriteria?.lho?.key || ""}
            onChange={handleRegionChange}
            className="glass-select"
          >
            <option value="">All Regions ({lhoOptions.length})</option>
            {lhoOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="glass-filter-item">
          <span className="glass-filter-label">RM Group</span>
          <select
            value={entityCriteria?.rm?.key || ""}
            onChange={handleRmChange}
            className="glass-select"
          >
            <option value="">All RMs ({rmOptions.length})</option>
            {rmOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="glass-filter-item">
          <span className="glass-filter-label">Search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search RMs, Alerts..."
            className="glass-input"
          />
        </div>

        <div className="glass-filter-item glass-slider-group">
          <div className="glass-slider-header">
            <span className="glass-filter-label">Days Inactive</span>
            <span className="glass-slider-value">{daysSliderValue}+</span>
          </div>
          <input
            type="range"
            min="3"
            max="90"
            value={daysSliderValue}
            onChange={handleSliderChange}
            className="glass-slider"
          />
          <div className="glass-slider-labels">
            <span>3d</span>
            <span>90d</span>
          </div>
        </div>
      </div>

      {disabledChannels.length > 0 && (
        <div className="channels-off-banner" role="status">
          <span aria-hidden="true">🔕</span>
          <span>
            <strong>{disabledChannels.join(" and ")}</strong> alerts are switched off in Settings —
            nothing is being sent on {disabledChannels.length > 1 ? "these channels" : "this channel"}.
            Inactivity is still tracked and recorded as usual.
          </span>
          <button
            type="button"
            className="channels-off-banner__link"
            onClick={() => {
              setActiveTab("system");
              setCardDetail(null);
            }}
          >
            Open settings
          </button>
        </div>
      )}

      {settings?.emailEnabled && settings.emailDraftOnly && (
        <div className="channels-off-banner" role="status">
          <span aria-hidden="true">🧪</span>
          <span>
            <strong>Email draft-only mode</strong> is on — RM/DC emails are being composed and saved as
            drafts, not sent. This is why Alert Delivery can look like everything failed: successful
            drafts aren&rsquo;t counted there as &ldquo;sent&rdquo; (they were never attempted for real
            delivery) — check Email Drafts for what actually went out. Only genuine problems, like a
            missing RM/DC contact, still show up as failed.
          </span>
          <button
            type="button"
            className="channels-off-banner__link"
            onClick={() => {
              setActiveTab("system");
              setCardDetail(null);
            }}
          >
            Open settings
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {!roster && !error ? (
        <div className="loading-state">Loading inactivity data&hellip;</div>
      ) : (
        roster && (
          <>
            {/* Quick Filter presets can still show click details */}
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

            <div className="app-main">
              {activeTab === "overview" && (
                <>
                  {/* Top KPI Cards Row */}
                  <div className="kpi-grid-4col">
                    <div className="kpi-card-mock kpi-card-mock--inactivity" onClick={showFilteredDetail} style={{ cursor: "pointer" }}>
                      <div className="kpi-card-mock__header">
                        <div className="kpi-card-mock__title-group">
                          <span className="kpi-card-mock__icon">📉</span>
                          <span className="kpi-card-mock__title">Inactivity Rate</span>
                        </div>
                        <span className="kpi-card-mock__arrow">›</span>
                      </div>
                      <div className="kpi-card-mock__body">
                        <span className="kpi-card-mock__value">{currentRate}%</span>
                        <div className="kpi-card-mock__trend-section">
                          {rateDelta !== null && (
                            <span className={`kpi-card-mock__trend-val ${rateDelta <= 0 ? "kpi-card-mock__trend-val--down" : "kpi-card-mock__trend-val--up"}`}>
                              {rateDelta <= 0 ? "▼" : "▲"} {rateDelta > 0 ? "+" : ""}{rateDelta}%
                            </span>
                          )}
                          <div className="kpi-card-mock__sparkline-container">
                            <svg viewBox="0 0 80 30" className="sparkline-svg">
                              <path d={getSparklineData(kpi?.trend)} className="sparkline-path" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="kpi-card-mock kpi-card-mock--rms" onClick={showRmDetail} style={{ cursor: "pointer" }}>
                      <div className="kpi-card-mock__header">
                        <div className="kpi-card-mock__title-group">
                          <span className="kpi-card-mock__icon">👥</span>
                          <span className="kpi-card-mock__title">RMs Affected</span>
                        </div>
                        <span className="kpi-card-mock__arrow">›</span>
                      </div>
                      <div className="kpi-card-mock__body">
                        <span className="kpi-card-mock__value">{rmCount}</span>
                        <div className="kpi-card-mock__trend-section">
                          <span className={`kpi-card-mock__trend-val${newOnsetsToday > 0 ? " kpi-card-mock__trend-val--up" : ""}`}>
                            {newOnsetsToday} new today
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="kpi-card-mock kpi-card-mock--alerts" onClick={() => handleQuickFilter("needsAttention")} style={{ cursor: "pointer" }}>
                      <div className="kpi-card-mock__header">
                        <div className="kpi-card-mock__title-group">
                          <span className="kpi-card-mock__icon">⚠️</span>
                          <span className="kpi-card-mock__title">Active Alerts</span>
                        </div>
                        <span className="kpi-card-mock__arrow">›</span>
                      </div>
                      <div className="kpi-card-mock__body">
                        <span className="kpi-card-mock__value">{needsAttentionToday.length}</span>
                        <div className="kpi-card-mock__trend-section">
                          <span className={`kpi-card-mock__trend-val${recoveredToday > 0 ? " kpi-card-mock__trend-val--down" : ""}`}>
                            {recoveredToday} resolved today
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="kpi-card-mock kpi-card-mock--escalated" onClick={() => handleQuickFilter("topCritical")} style={{ cursor: "pointer" }}>
                      <div className="kpi-card-mock__header">
                        <div className="kpi-card-mock__title-group">
                          <span className="kpi-card-mock__icon">🚨</span>
                          <span className="kpi-card-mock__title">Escalated Issues</span>
                        </div>
                        <span className="kpi-card-mock__arrow">›</span>
                      </div>
                      <div className="kpi-card-mock__body">
                        <span className="kpi-card-mock__value">{criticalRecords.length}</span>
                        <div className="kpi-card-mock__trend-section">
                          <span className={`kpi-card-mock__trend-val${escalatedOnsetsToday > 0 ? " kpi-card-mock__trend-val--up" : ""}`}>
                            {escalatedOnsetsToday} escalated today
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Composed Layout Grid */}
                  <div className="main-dashboard-grid">
                    <div className="main-chart-panel">
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
                          dailyChanges={dailyChanges}
                          onRangeChipClick={setRange}
                          onTierChipClick={showTierDetail}
                          onFilteredCardClick={showFilteredDetail}
                        />
                      )}
                    </div>

                    <div className="sidebar-panels">
                      <Panel title="Critical Alerts Feed">
                        <div className="alerts-feed-list">
                          {criticalFeed.map((r) => (
                            <div key={r.cspCode} className="feed-item">
                              <div className="feed-item__left">
                                <div className="avatar-circle">
                                  {r.targetPersonName
                                    ? r.targetPersonName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
                                    : "CSP"}
                                </div>
                                <div className="feed-item__info">
                                  <span className="feed-item__name">{r.targetPersonName}</span>
                                  <span className="feed-item__meta">ID: {r.cspCode} · {r.days} Days Inactive</span>
                                </div>
                              </div>
                              <span className={`feed-item__badge ${r.days && r.days >= 24 ? "badge--high" : "badge--med"}`}>
                                {r.days && r.days >= 24 ? "High" : "Med"}
                              </span>
                            </div>
                          ))}
                          {criticalFeed.length === 0 && (
                            <div className="empty-state">No critical alerts today.</div>
                          )}
                        </div>
                      </Panel>

                      <Panel title="RM Performance Leaderboard">
                        <div className="leaderboard-list">
                          {rmLeaderboard.map((rm, idx) => (
                            <div key={rm.name} className="leaderboard-item">
                              <div className="leaderboard-item__left">
                                <span className={`leaderboard-item__rank leaderboard-item__rank--${idx + 1}`}>{idx + 1}</span>
                                <span className="leaderboard-item__name">{rm.name}</span>
                              </div>
                              <span className="leaderboard-item__score">Avg {rm.avgDays}d</span>
                            </div>
                          ))}
                          {rmLeaderboard.length === 0 && (
                            <div className="empty-state">No RM data available.</div>
                          )}
                        </div>
                      </Panel>
                    </div>
                  </div>

                  <DataTable records={visibleRecords} thresholdLabel={filterLabel} />
                </>
              )}

              {activeTab === "insights" && (
                <>
                  <div className="dashboard-grid-2col">
                    <DailySummaryPanel />
                    <RecommendationsPanel />
                  </div>
                  <AtRiskPanel />
                  <TopCriticalPanel records={criticalRecords} />
                </>
              )}

              {activeTab === "analytics" && (
                <>
                  <div className="dashboard-grid-2col">
                    <GeoHeatMap />
                    <RmDcPerformancePanel />
                  </div>
                  <SummaryChart data={summaryByRm} thresholdLabel={filterLabel} />
                </>
              )}

              {activeTab === "system" && (
                <>
                  <div style={{ marginBottom: "16px", display: "flex", justifyContent: "flex-end" }}>
                    <TriggerRunButton onComplete={refreshAll} />
                  </div>
                  <SettingsPanel onSaved={setSettings} />
                  <TemplatesPanel />
                  <div className="dashboard-grid-2col">
                    <DailyChangesPanel />
                    <AdaptiveTuningPanel />
                  </div>
                  {delivery && <DeliveryPanel summary={delivery} />}
                  <MessageReachPanel />
                  <EmailDraftsPanel />
                  <AllCspsTable records={roster.records} />
                  <TestDeliveryPanel />
                </>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}
