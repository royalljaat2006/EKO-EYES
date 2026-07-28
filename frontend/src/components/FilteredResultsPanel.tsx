import { useEffect, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { InactivityRecord } from "../types";
import { statusOf, STATUS_META, STATUS_ORDER } from "../statusOptions";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";
import RowActions from "./RowActions";

const PAGE_SIZE = 25;

interface Props {
  /** What's shown as the panel heading — e.g. "LHO: Chandigarh" or a search query. */
  title: string;
  /** Already-filtered records to display — this component doesn't filter, only renders. */
  records: InactivityRecord[];
  /** Shown next to the empty state / table when there are zero matches. */
  emptyMessage?: string;
  onClear: () => void;
}

interface StatusDatum {
  label: string;
  count: number;
  color: string;
}

function StatusTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload as StatusDatum;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__title">{datum.label}</div>
      <div className="chart-tooltip__value">
        {datum.count} CSP{datum.count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

/**
 * Shared rendering for "here's a filtered slice of the roster" — a status
 * chart plus the matching CSPs table — used both by the LHO/RM/DC combo
 * filter (EntityResultsPanel) and the universal search bar. Always rendered
 * INLINE in the page, never as a popup.
 */
export default function FilteredResultsPanel({
  title,
  records,
  emptyMessage = "No CSPs match.",
  onClear,
}: Props) {
  const statusChartData: StatusDatum[] = useMemo(
    () =>
      STATUS_ORDER.map((s) => ({
        label: STATUS_META[s].label,
        count: records.filter((r) => statusOf(r) === s).length,
        color: STATUS_META[s].color,
      })),
    [records],
  );

  const { page, pageCount, visible, setPage, resetPage } = usePagination(records, PAGE_SIZE);

  // A new title means a different card/filter was picked — a genuinely new
  // query, not the same one with fewer rows — so start the reader back at
  // page 1 instead of leaving them wherever they'd scrolled to before.
  useEffect(() => {
    resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  return (
    <Panel
      title={title}
      focusable
      subtitle={`${records.length} CSP${records.length === 1 ? "" : "s"}`}
      headerExtra={
        <button type="button" className="entity-filter__clear" onClick={onClear}>
          Clear
        </button>
      }
    >
      {records.length > 0 && (
        <div className="entity-modal__chart">
          <span className="entity-modal__chart-title">Inactivity status</span>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={statusChartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--muted)" }}
                axisLine={{ stroke: "var(--baseline)" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip content={StatusTooltip} cursor={{ fill: "var(--hover-wash)" }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={64}>
                {statusChartData.map((d) => (
                  <Cell key={d.label} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>CSP Code</th>
              <th>CSP Name</th>
              <th>Days</th>
              <th>Status</th>
              <th>Terminal</th>
              <th>CSP Mobile</th>
              <th>LHO</th>
              <th>RM</th>
              <th>DC</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const pill = STATUS_META[statusOf(r)];
              return (
                <tr key={r.sourceRow}>
                  <td className="num">{page * PAGE_SIZE + i + 1}</td>
                  <td className="num">{r.cspCode || "—"}</td>
                  <td>{r.targetPersonName}</td>
                  <td className="num">{r.days ?? "—"}</td>
                  <td>
                    <span className={`status-pill ${pill.className}`}>
                      <span aria-hidden="true">{pill.icon}</span> {pill.label}
                    </span>
                  </td>
                  <td>{r.terminalStatus || "—"}</td>
                  <td className="num">{r.cspMobile || "—"}</td>
                  <td>{r.lhoName || "—"}</td>
                  <td>{r.rmName || "—"}</td>
                  <td>{r.dcName || "—"}</td>
                  <td>
                    <RowActions record={r} />
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={11} className="empty-state">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageCount={pageCount}
        visibleCount={visible.length}
        totalCount={records.length}
        onPrev={() => setPage(page - 1)}
        onNext={() => setPage(page + 1)}
      />
    </Panel>
  );
}
