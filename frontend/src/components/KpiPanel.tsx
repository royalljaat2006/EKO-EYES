import { useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { DailyChanges, KpiReport } from "../types";
import { RANGE_OPTIONS, RANGE_LABELS } from "../rangeOptions";
import type { RangeOption, RangeFilter } from "../rangeOptions";
import type { Tier } from "../tierOptions";
import Panel from "./Panel";

interface Props {
  kpi: KpiReport;
  /** The header filter's current selection (a bucket, or "all"), so the range strip can highlight it. */
  range: RangeFilter;
  /** Count per bucket across the full roster (unmeasurable folded into 90+), independent of the filter. */
  rangeCounts: Record<RangeOption, number> | null;
  /** How many CSPs match EVERY active filter (range + LHO/RM/DC + search) right now. */
  filteredCount: number;
  /** The population the % is measured against — every active filter EXCEPT range (range is what filteredCount narrows within it). */
  totalCount: number;
  /** filteredCount / totalCount * 100 — computed once in App.tsx so every consumer agrees. */
  currentRate: number;
  onTarget: boolean;
  /** Describes whatever combination of range/LHO/RM/DC/search is currently active. */
  filterLabel: string;
  /** true when LHO/RM/DC or search is active — there's no stored history for that combination, only "today" is knowable. */
  hasSecondaryFilter: boolean;
  /** Today's live count for the current combined filter — always accurate even when history isn't available. */
  liveToday: { day: string; count: number };
  /** Today's named onset/recovery audit trail — same source DailyChangesPanel shows. Null until it's loaded. */
  dailyChanges: DailyChanges | null;
  onRangeChipClick: (opt: RangeOption) => void;
  onTierChipClick: (tier: Tier) => void;
  onFilteredCardClick: () => void;
}

/** "2026-07-20" -> "20 Jul" — a day-of-month label, since the trend spans up to 30 days (a month). */
function formatDayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/**
 * The last `n` calendar days as "YYYY-MM-DD" strings, oldest first, ending
 * today. Used to seed the X-axis with every real date up front — a
 * recharts category axis spaces whatever entries exist evenly by INDEX, not
 * by actual elapsed time, so without this a chart with only 2-3 real data
 * points (normal in this system's first weeks) looks stretched evenly
 * across the full width as if they were consecutive days. Seeding the full
 * window fixes the spacing to real calendar time and means the chart
 * visibly "grows" — more of the window has real dots — as the daily job
 * keeps running, rather than looking complete on day one.
 */
function lastNDays(n: number): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const WINDOW_OPTIONS = [7, 14, 30] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];
type Frequency = "daily" | "weekly";

/** The Monday on/before `day`, as "YYYY-MM-DD" — the bucket key for weekly grouping. */
function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  const diffToMonday = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setDate(d.getDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Collapses daily points into one-per-week: `count` (a point-in-time level,
 * not a flow) takes the most recent day's value within the week, while
 * `recovered`/`newlyInactive` (flows) are summed across the week — same
 * stock-vs-flow distinction the dual Y-axes already draw.
 */
function toWeeklyBuckets(daily: MergedTrendDatum[]): MergedTrendDatum[] {
  const buckets = new Map<
    string,
    { count?: number; countDay?: string; recovered?: number; newlyInactive?: number }
  >();
  for (const d of daily) {
    const key = weekStart(d.day);
    const bucket = buckets.get(key) ?? {};
    if (d.count !== undefined && (!bucket.countDay || d.day > bucket.countDay)) {
      bucket.count = d.count;
      bucket.countDay = d.day;
    }
    if (d.recovered !== undefined) bucket.recovered = (bucket.recovered ?? 0) + d.recovered;
    if (d.newlyInactive !== undefined) bucket.newlyInactive = (bucket.newlyInactive ?? 0) + d.newlyInactive;
    buckets.set(key, bucket);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      count: v.count,
      recovered: v.recovered,
      newlyInactive: v.newlyInactive,
    }));
}

interface MergedTrendDatum {
  day: string;
  /** CSPs matching the current filter that day — undefined for days we don't have a figure for. */
  count?: number;
  recovered?: number;
  newlyInactive?: number;
}

function CombinedTrendTooltip({
  active,
  payload,
  label,
  filterLabel,
  frequency,
}: TooltipContentProps<ValueType, NameType> & { filterLabel: string; frequency: "daily" | "weekly" }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload as MergedTrendDatum;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__title">
        {frequency === "weekly" ? `Week of ${formatDayLabel(label as string)}` : formatDayLabel(label as string)}
      </div>
      {p.count !== undefined && (
        <div className="chart-tooltip__value">
          {p.count} CSP{p.count === 1 ? "" : "s"} ({filterLabel})
        </div>
      )}
      {p.recovered !== undefined && (
        <div className="chart-tooltip__value" style={{ color: "var(--good)" }}>
          +{p.recovered} recovered
        </div>
      )}
      {p.newlyInactive !== undefined && (
        <div className="chart-tooltip__value" style={{ color: "var(--critical)" }}>
          −{p.newlyInactive} newly inactive
        </div>
      )}
    </div>
  );
}

export default function KpiPanel({
  kpi,
  range,
  rangeCounts,
  filteredCount,
  totalCount,
  currentRate,
  onTarget,
  filterLabel,
  hasSecondaryFilter,
  liveToday,
  dailyChanges,
  onRangeChipClick,
  onTierChipClick,
  onFilteredCardClick,
}: Props) {
  const gap = Number((currentRate - kpi.targetRate).toFixed(2));

  // Today's real counts, from the same named audit trail Daily Changes shows
  // — never a fabricated or estimated number. Whole-roster only (the
  // daily-diff log has no per-LHO/RM/DC/search breakdown — see the
  // dailyChangeData comment below), so these are hidden when a secondary
  // filter is active rather than implying they're scoped to it.
  const newlyInactiveToday = !hasSecondaryFilter ? (dailyChanges?.newlyInactive.length ?? 0) : null;
  const recoveredToday = !hasSecondaryFilter ? (dailyChanges?.recovered.length ?? 0) : null;
  // Mirrors the backend's own 30-day recoveryRate formula (recoveries / (recoveries + currentInactive)),
  // just with today's recovered count as the numerator instead of the 30-day one — same shape, tighter window.
  const todayRecoveryRate =
    recoveredToday === null
      ? null
      : recoveredToday + kpi.currentInactive === 0
        ? null
        : Number(((recoveredToday / (recoveredToday + kpi.currentInactive)) * 100).toFixed(1));

  // The graph's own filter — separate from the page-level range/LHO/RM/DC/
  // search filters above. Purely a display choice over the same underlying
  // data, so it's local state here rather than threaded through App.tsx.
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [frequency, setFrequency] = useState<Frequency>("daily");

  // Both halves of the daily-change picture: how many CSPs recovered today
  // vs. how many went active -> inactive today. Older rows (before
  // newlyInactive was tracked) are skipped rather than shown as a fake zero.
  // This is whole-roster only — there's no per-person historical record of WHO
  // changed on WHICH day to break down by LHO/RM/DC/search yet (that's the
  // daily-diff log — see SKILLS.md task 5). Showing whole-roster bars on a
  // chart that's otherwise filtered to e.g. one LHO would misleadingly imply
  // they're specific to that LHO, so they're hidden entirely whenever a
  // secondary filter is active — the line (which IS filter-accurate for
  // today) is all that shows in that case.
  const dailyChangeData: MergedTrendDatum[] = hasSecondaryFilter
    ? []
    : kpi.trend
        .filter((s) => s.newlyInactive !== null && s.newlyInactive !== undefined)
        .map((s) => ({
          day: s.day,
          recovered: s.recoveries,
          newlyInactive: s.newlyInactive as number,
        }));

  // The count LINE's history genuinely doesn't exist broken down by LHO/RM/DC/
  // search — only per range-bucket, per day, is stored. So when a secondary
  // filter is active, the line honestly shows just today's point rather than
  // fabricating history for a combination that was never recorded.
  const countSeries = hasSecondaryFilter ? [liveToday] : kpi.rangeTrend;

  // One graph, one X axis (day, spanning up to a month): the range-trend
  // count and the recovered/newly-inactive bars are merged by day rather than
  // drawn as two separate charts. A day missing from one side simply leaves
  // that field undefined so its bar/line point doesn't render, rather than a
  // fake 0. Seeded with every real calendar date in the window up front (see
  // lastNDays) so the axis is spaced by actual elapsed time, not by however
  // many days happen to have data yet.
  const mergedTrendMap = new Map<string, MergedTrendDatum>();
  for (const day of lastNDays(30)) {
    mergedTrendMap.set(day, { day });
  }
  for (const p of countSeries) {
    mergedTrendMap.set(p.day, { ...mergedTrendMap.get(p.day), day: p.day, count: p.count });
  }
  for (const d of dailyChangeData) {
    mergedTrendMap.set(d.day, {
      ...mergedTrendMap.get(d.day),
      day: d.day,
      recovered: d.recovered,
      newlyInactive: d.newlyInactive,
    });
  }
  const mergedTrend = Array.from(mergedTrendMap.values()).sort((a, b) => a.day.localeCompare(b.day));

  // The graph-specific window/frequency filter applies here, on top of the
  // full 30-day scaffold above — narrow to the selected window, then
  // optionally collapse to one point per week.
  const windowTrend = mergedTrend.slice(-windowDays);
  const displayTrend = frequency === "weekly" ? toWeeklyBuckets(windowTrend) : windowTrend;
  const daysWithData = windowTrend.filter((d) => d.count !== undefined || d.recovered !== undefined).length;

  return (
    <Panel title="Progress to target" subtitle={`Goal: keep inactivity at or below ${kpi.targetRate}%`} focusable>
      <div className="kpi-hero">
        <div className="kpi-hero__main">
          <span className={`kpi-hero__value${onTarget ? " kpi-hero__value--good" : " kpi-hero__value--bad"}`}>
            {currentRate}%
          </span>
          <span className="kpi-hero__label">
            {filterLabel} &mdash; {filteredCount} of {totalCount} CSP{totalCount === 1 ? "" : "s"}
            {range === "90+" && "  ·  ignored: no active work, counted in Total CSPs only"}
          </span>
          <span className={`status-pill ${onTarget ? "status--delivered" : "status--failed"}`}>
            <span aria-hidden="true">{onTarget ? "✓" : "✕"}</span>{" "}
            {onTarget ? `On target` : `${gap > 0 ? "+" : ""}${gap} pts above target`}
          </span>
        </div>

        <div className="kpi-grid">
          <button type="button" className="delivery-stat delivery-stat--clickable" onClick={onFilteredCardClick}>
            <span
              className={`delivery-stat__value ${range === "90+" ? "delivery-stat__value--muted" : "delivery-stat__value--warn"}`}
            >
              {filteredCount}
            </span>
            <span className="delivery-stat__label">
              {range === "90+" ? "Ignored" : "Inactive"} &mdash; {filterLabel} (click to view)
            </span>
            {newlyInactiveToday !== null && (
              <span className="delivery-stat__today">+{newlyInactiveToday} new today</span>
            )}
          </button>
          <div className="delivery-stat">
            <span className="delivery-stat__value delivery-stat__value--good">{kpi.recoveries}</span>
            <span className="delivery-stat__label">Activated successfully (30d)</span>
            {recoveredToday !== null && (
              <span className="delivery-stat__today">+{recoveredToday} today</span>
            )}
          </div>
          <div className="delivery-stat">
            <span className="delivery-stat__value">{kpi.recoveryRate}%</span>
            <span className="delivery-stat__label">Recovery rate (30d) — is the alerting working?</span>
            {todayRecoveryRate !== null ? (
              <span className="delivery-stat__today">Today: {todayRecoveryRate}%</span>
            ) : (
              recoveredToday !== null && <span className="delivery-stat__today">Today: —</span>
            )}
          </div>
        </div>
      </div>

      <div className="kpi-chart-header">
        <div>
          <span className="kpi-chart-header__title">
            Trends &mdash; {frequency === "daily" ? "day by day" : "week by week"}, last {windowDays} days
          </span>
          <span className="panel__subtitle">
            {hasSecondaryFilter ? "Today only — no history for this combination yet" : "Follows every filter above"}
          </span>
        </div>
        <div className="chart-controls">
          <div className="chart-controls__group" role="group" aria-label="Graph date window">
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w}
                type="button"
                className={`chart-controls__btn${w === windowDays ? " chart-controls__btn--active" : ""}`}
                onClick={() => setWindowDays(w)}
              >
                {w}d
              </button>
            ))}
          </div>
          <div className="chart-controls__group" role="group" aria-label="Graph data frequency">
            {(["daily", "weekly"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`chart-controls__btn${f === frequency ? " chart-controls__btn--active" : ""}`}
                onClick={() => setFrequency(f)}
              >
                {f === "daily" ? "Daily" : "Weekly"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {daysWithData >= 1 ? (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={displayTrend} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <defs>
                <linearGradient id="areaGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--brand-amber, #f5a623)" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="var(--brand-amber, #f5a623)" stopOpacity={0.01}/>
                </linearGradient>
                <linearGradient id="barBlue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--series-1, #2a78d6)" stopOpacity={0.75}/>
                  <stop offset="95%" stopColor="var(--series-1, #2a78d6)" stopOpacity={0.1}/>
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--gridline)" />
              <XAxis
                dataKey="day"
                tickFormatter={(d: string) => (frequency === "weekly" ? `Wk ${formatDayLabel(d)}` : formatDayLabel(d))}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={{ stroke: "var(--baseline)" }}
                tickLine={false}
                minTickGap={150}
              />
              <YAxis
                yAxisId="change"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
                width={40}
                allowDecimals={false}
                domain={[0, (max: number) => Math.max(max, 1)]}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
                width={40}
                allowDecimals={false}
                domain={[0, (max: number) => Math.max(max, 1)]}
              />
              <Tooltip content={(p) => <CombinedTrendTooltip {...p} filterLabel={filterLabel} frequency={frequency} />} />
              <Legend
                formatter={(value: string) => (
                  <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{value}</span>
                )}
              />
              <Bar
                yAxisId="change"
                dataKey="recovered"
                name="Recovered (Left Y)"
                fill="var(--good-wash)"
                stroke="var(--good)"
                strokeWidth={1}
                radius={[6, 6, 0, 0]}
                maxBarSize={20}
                isAnimationActive={false}
              />
              <Bar
                yAxisId="change"
                dataKey="newlyInactive"
                name="Newly Inactive (Left Y)"
                fill="url(#barBlue)"
                stroke="var(--series-1)"
                strokeWidth={1}
                radius={[6, 6, 0, 0]}
                maxBarSize={20}
                isAnimationActive={false}
              />
              <Area
                yAxisId="count"
                type="monotone"
                dataKey="count"
                stroke="none"
                fill="url(#areaGlow)"
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="count"
                name="Total Inactive (Right Y)"
                stroke="var(--brand-amber, #f5a623)"
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 2, fill: "var(--surface-1)" }}
                activeDot={{ r: 6, strokeWidth: 2, fill: "var(--surface-1)" }}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          {daysWithData <= 1 && (
            <p className="empty-state empty-state--muted">
              {hasSecondaryFilter
                ? "History isn't available for LHO/RM/DC/search combinations yet — only today's count."
                : "Only today's count is available for this range yet — the graph fills in, day by day at its real date, as the daily job keeps running."}
            </p>
          )}
        </>
      ) : (
        <p className="empty-state">No trend data available yet.</p>
      )}

      <div className="tier-strip">
        {kpi.byTier.map((t) => (
          <button
            type="button"
            key={t.tier}
            className={`tier-chip tier-chip--${t.tier} tier-chip--clickable`}
            onClick={() => onTierChipClick(t.tier as Tier)}
          >
            <span className="tier-chip__count">{t.count}</span>
            <span className="tier-chip__range">{t.range}</span>
          </button>
        ))}
      </div>

      {rangeCounts && (
        <div className="range-strip">
          <span className="range-strip__label">
            By inactivity range &mdash; click to filter &middot; 90+ includes unmeasurable CSPs, ignored from
            Inactive totals under "All Days" (still counted in Total CSPs)
          </span>
          <div className="range-strip__row">
            {RANGE_OPTIONS.map((opt) => {
              const ignored = opt === "90+";
              return (
                <button
                  type="button"
                  key={opt}
                  className={`range-chip range-chip--clickable${opt === range ? " range-chip--active" : ""}${ignored ? " range-chip--ignored" : ""}`}
                  onClick={() => onRangeChipClick(opt)}
                >
                  <span className="range-chip__count">{rangeCounts[opt]}</span>
                  <span className="range-chip__label">{RANGE_LABELS[opt]}</span>
                  {ignored && <span className="range-chip__tag">Ignored &middot; no active work</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
