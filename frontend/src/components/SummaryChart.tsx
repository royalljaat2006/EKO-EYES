import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { RmGroupSummary } from "../types";

interface Props {
  data: RmGroupSummary[];
  thresholdLabel: string;
}

function CustomTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const datum = entry.payload as RmGroupSummary;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__title">{datum.rmName}</div>
      <div className="chart-tooltip__value">{String(entry.value)} inactive personnel</div>
    </div>
  );
}

export default function SummaryChart({ data, thresholdLabel }: Props) {
  if (data.length === 0) {
    return (
      <div className="panel">
        <div className="panel__header">
          <h2>Inactive personnel by RM</h2>
          <span className="panel__subtitle">{thresholdLabel}</span>
        </div>
        <p className="empty-state">No inactive personnel at this threshold.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Inactive personnel by RM</h2>
        <span className="panel__subtitle">{thresholdLabel}</span>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--gridline)" />
          <XAxis
            dataKey="rmName"
            tick={{ fontSize: 12, fill: "var(--muted)" }}
            axisLine={{ stroke: "var(--baseline)" }}
            tickLine={false}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={64}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip content={CustomTooltip} cursor={{ fill: "var(--hover-wash)" }} />
          <Bar dataKey="count" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
