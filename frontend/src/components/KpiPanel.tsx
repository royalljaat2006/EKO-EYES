import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { KpiReport } from "../types";
import { RANGE_OPTIONS, RANGE_LABELS } from "../rangeOptions";
import type { RangeOption, RangeFilter } from "../rangeOptions";
import type { Tier } from "../tierOptions";

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

interface MergedTrendDatum {
  day: string;
  /** CSPs matching the current filter that day — undefined for days we don't have a figure for. */
  count?: number;
  recovered?: number;
  newlyInactive?: number;
  /** Negated purely so the bar draws below the zero line; tooltip shows the real count. */
  newlyInactiveDisplay?: number;
}

function CombinedTrendTooltip({
  active,
  payload,
  label,
  filterLabel,
}: TooltipContentProps<ValueType, NameType> & { filterLabel: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload as MergedTrendDatum;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__title">{formatDayLabel(label as string)}</div>
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
  onRangeChipClick,
  onTierChipClick,
  onFilteredCardClick,
}: Props) {
  const gap = Number((currentRate - kpi.targetRate).toFixed(2));

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
          newlyInactiveDisplay: -(s.newlyInactive as number),
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
  // fake 0.
  const mergedTrendMap = new Map<string, MergedTrendDatum>();
  for (const p of countSeries) {
    mergedTrendMap.set(p.day, { ...mergedTrendMap.get(p.day), day: p.day, count: p.count });
  }
  for (const d of dailyChangeData) {
    mergedTrendMap.set(d.day, {
      ...mergedTrendMap.get(d.day),
      day: d.day,
      recovered: d.recovered,
      newlyInactive: d.newlyInactive,
      newlyInactiveDisplay: d.newlyInactiveDisplay,
    });
  }
  const mergedTrend = Array.from(mergedTrendMap.values()).sort((a, b) => a.day.localeCompare(b.day));

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Progress to target</h2>
        <span className="panel__subtitle">Goal: keep inactivity at or below {kpi.targetRate}%</span>
      </div>

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
          </button>
          <div className="delivery-stat">
            <span className="delivery-stat__value delivery-stat__value--good">{kpi.recoveries}</span>
            <span className="delivery-stat__label">Activated successfully (30d)</span>
          </div>
          <div className="delivery-stat">
            <span className="delivery-stat__value">{kpi.recoveryRate}%</span>
            <span className="delivery-stat__label">Recovery rate — is the alerting working?</span>
          </div>
        </div>
      </div>

      <div className="kpi-chart-header">
        <span className="kpi-chart-header__title">Trends &mdash; day by day, over the month</span>
        <span className="panel__subtitle">
          {hasSecondaryFilter ? "Today only — no history for this combination yet" : "Follows every filter above"}
        </span>
      </div>

      {mergedTrend.length >= 1 ? (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={mergedTrend} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" />
              <XAxis
                dataKey="day"
                tickFormatter={formatDayLabel}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={{ stroke: "var(--baseline)" }}
                tickLine={false}
                minTickGap={20}
              />
              <YAxis
                yAxisId="change"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
                width={40}
                allowDecimals={false}
                tickFormatter={(v: number) => String(Math.abs(v))}
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
              <ReferenceLine yAxisId="change" y={0} stroke="var(--baseline)" />
              <Tooltip content={(p) => <CombinedTrendTooltip {...p} filterLabel={filterLabel} />} />
              <Legend
                formatter={(value: string) => (
                  <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{value}</span>
                )}
              />
              <Bar
                yAxisId="change"
                dataKey="recovered"
                name="Recovered"
                fill="var(--good)"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
              <Bar
                yAxisId="change"
                dataKey="newlyInactiveDisplay"
                name="Newly inactive"
                fill="var(--critical)"
                radius={[0, 0, 4, 4]}
                maxBarSize={28}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="count"
                name={`CSPs (${filterLabel})`}
                stroke="var(--series-1)"
                strokeWidth={2}
                dot={{ r: 4 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          {mergedTrend.length === 1 && (
            <p className="empty-state empty-state--muted">
              {hasSecondaryFilter
                ? "History isn't available for LHO/RM/DC/search combinations yet — only today's count."
                : "Only today's count is available for this range yet — the line fills in as the daily job records more days."}
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
            <span className="tier-chip__label">{t.label}</span>
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
    </div>
  );
}
