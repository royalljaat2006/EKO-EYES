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
import Panel from "./Panel";

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
      <Panel title="Inactive personnel by RM" subtitle={thresholdLabel} focusable>
        <p className="empty-state">No inactive personnel at this threshold.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Inactive personnel by RM" subtitle={thresholdLabel} focusable>
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
    </Panel>
  );
}
