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
import { RANGE_OPTIONS, RANGE_LABELS, RANGE_FILTER_LABELS } from "../rangeOptions";
import type { RangeOption, RangeFilter } from "../rangeOptions";

interface Props {
  kpi: KpiReport;
  /** The header filter's current selection (a bucket, or "all"), so the range strip can highlight it. */
  range: RangeFilter;
  /** Count per bucket across the full roster, independent of the filter. */
  rangeCounts: Record<RangeOption, number> | null;
  /** How many CSPs match the header filter right now — the same number the table/chart below show. */
  filteredCount: number;
}

/** "2026-07-20" -> "20 Jul" — a day-of-month label, since the trend spans up to 30 days (a month). */
function formatDayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

interface MergedTrendDatum {
  day: string;
  /** CSPs in the selected range that day — undefined for days outside kpi.rangeTrend. */
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
  rangeLabel,
}: TooltipContentProps<ValueType, NameType> & { rangeLabel: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload as MergedTrendDatum;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__title">{formatDayLabel(label as string)}</div>
      {p.count !== undefined && (
        <div className="chart-tooltip__value">
          {p.count} CSP{p.count === 1 ? "" : "s"} ({rangeLabel})
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

export default function KpiPanel({ kpi, range, rangeCounts, filteredCount }: Props) {
  const gap = Number((kpi.currentRate - kpi.targetRate).toFixed(2));

  // Both halves of the daily-change picture: how many CSPs recovered today
  // vs. how many went active -> inactive today. Older rows (before
  // newlyInactive was tracked) are skipped rather than shown as a fake zero —
  // same rule as the range-trend data below.
  const dailyChangeData: MergedTrendDatum[] = kpi.trend
    .filter((s) => s.newlyInactive !== null && s.newlyInactive !== undefined)
    .map((s) => ({
      day: s.day,
      recovered: s.recoveries,
      newlyInactive: s.newlyInactive as number,
      newlyInactiveDisplay: -(s.newlyInactive as number),
    }));

  // One graph, one X axis (day, spanning up to a month): the range-trend
  // count and the recovered/newly-inactive bars are merged by day rather than
  // drawn as two separate charts. Neither dataset's own computation changed —
  // this only combines them for display. A day missing from one side (e.g.
  // today, before the daily job has logged newlyInactive) simply leaves that
  // field undefined so its bar/line point doesn't render, rather than a fake 0.
  const mergedTrendMap = new Map<string, MergedTrendDatum>();
  for (const p of kpi.rangeTrend) {
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
          <span
            className={`kpi-hero__value${
              kpi.onTarget ? " kpi-hero__value--good" : " kpi-hero__value--bad"
            }`}
          >
            {kpi.currentRate}%
          </span>
          <span className="kpi-hero__label">
            Current inactivity ({kpi.currentInactive} of {kpi.totalPeople} measurable
            {kpi.unknownPeople > 0 && `; ${kpi.unknownPeople} unmeasurable`})
          </span>
          <span className={`status-pill ${kpi.onTarget ? "status--delivered" : "status--failed"}`}>
            <span aria-hidden="true">{kpi.onTarget ? "✓" : "✕"}</span>{" "}
            {kpi.onTarget
              ? `On target`
              : `${gap > 0 ? "+" : ""}${gap} pts above target`}
          </span>
        </div>

        <div className="kpi-grid">
          <div className="delivery-stat">
            <span className="delivery-stat__value delivery-stat__value--warn">{filteredCount}</span>
            <span className="delivery-stat__label">
              Inactive &mdash; {RANGE_FILTER_LABELS[range]} (follows the header filter)
            </span>
          </div>
          <div className="delivery-stat">
            <span className="delivery-stat__value delivery-stat__value--good">
              {kpi.recoveries}
            </span>
            <span className="delivery-stat__label">Recovered (30d)</span>
          </div>
          <div className="delivery-stat">
            <span className="delivery-stat__value">{kpi.recoveryRate}%</span>
            <span className="delivery-stat__label">Recovery rate — is the alerting working?</span>
          </div>
        </div>
      </div>

      <div className="kpi-chart-header">
        <span className="kpi-chart-header__title">Trends &mdash; day by day, over the month</span>
        <span className="panel__subtitle">Follows the header filter &mdash; today is always live</span>
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
              <Tooltip
                content={(p) => <CombinedTrendTooltip {...p} rangeLabel={RANGE_FILTER_LABELS[range]} />}
              />
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
                name={`CSPs (${RANGE_FILTER_LABELS[range]})`}
                stroke="var(--series-1)"
                strokeWidth={2}
                dot={{ r: 4 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          {mergedTrend.length === 1 && (
            <p className="empty-state empty-state--muted">
              Only today&rsquo;s point is available yet &mdash; more of the month fills in as the daily
              job keeps running.
            </p>
          )}
        </>
      ) : (
        <p className="empty-state">No trend data available yet.</p>
      )}

      <div className="tier-strip">
        {kpi.byTier.map((t) => (
          <div key={t.tier} className={`tier-chip tier-chip--${t.tier}`}>
            <span className="tier-chip__count">{t.count}</span>
            <span className="tier-chip__label">{t.label}</span>
            <span className="tier-chip__range">{t.range}</span>
          </div>
        ))}
      </div>

      {rangeCounts && (
        <div className="range-strip">
          <span className="range-strip__label">By inactivity range &mdash; filter selection highlighted</span>
          <div className="range-strip__row">
            {RANGE_OPTIONS.map((opt) => (
              <div
                key={opt}
                className={`range-chip${opt === range ? " range-chip--active" : ""}`}
              >
                <span className="range-chip__count">{rangeCounts[opt]}</span>
                <span className="range-chip__label">{RANGE_LABELS[opt]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
