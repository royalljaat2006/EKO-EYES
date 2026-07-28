import { useMemo, useState } from "react";
import type { InactivityRecord } from "../types";
import { RANGE_OPTIONS as BASE_RANGE_OPTIONS, RANGE_LABELS, inRange as inBucket } from "../rangeOptions";
import type { RangeOption } from "../rangeOptions";
import { statusOf, STATUS_META } from "../statusOptions";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";
import RowActions from "./RowActions";

type StatusFilter = "all" | "inactive" | "at-risk" | "healthy" | "unknown";

const PAGE_SIZE = 50;

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "inactive", label: "Inactive (>7d)" },
  { value: "at-risk", label: "3–7d" },
  { value: "healthy", label: "Healthy (<3d)" },
  { value: "unknown", label: "Unmeasurable" },
];

/** Inactivity-day buckets, same as the main filter — plus "all" for this table's own view. */
type RangeFilter = "all" | RangeOption;

const RANGE_FILTER_OPTIONS: { value: RangeFilter; label: string }[] = [
  { value: "all", label: "All ranges" },
  ...BASE_RANGE_OPTIONS.map((value) => ({ value, label: RANGE_LABELS[value] })),
];

function inRange(days: number | null, range: RangeFilter): boolean {
  if (range === "all") return true;
  return inBucket(days, range);
}

interface Props {
  records: InactivityRecord[];
}

export default function AllCspsTable({ records }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [range, setRange] = useState<RangeFilter>("all");

  const counts = useMemo(() => {
    const c = { all: records.length, inactive: 0, "at-risk": 0, healthy: 0, unknown: 0 };
    for (const r of records) c[statusOf(r)]++;
    return c as Record<StatusFilter, number>;
  }, [records]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (status !== "all" && statusOf(r) !== status) return false;
      if (!inRange(r.days, range)) return false;
      if (!q) return true;
      return (
        r.cspCode.toLowerCase().includes(q) ||
        r.targetPersonName.toLowerCase().includes(q) ||
        r.rmName.toLowerCase().includes(q) ||
        r.dcName.toLowerCase().includes(q) ||
        r.cspMobile.includes(q) ||
        (r.rm?.email ?? "").toLowerCase().includes(q) ||
        (r.rm?.mobile ?? "").includes(q) ||
        (r.dc?.email ?? "").toLowerCase().includes(q) ||
        (r.dc?.mobile ?? "").includes(q)
      );
    });
  }, [records, query, status, range]);

  const { page, pageCount, visible, setPage, resetPage } = usePagination(filtered, PAGE_SIZE);

  const reset = (fn: () => void) => {
    fn();
    resetPage();
  };

  return (
    <Panel
      title="All CSPs"
      focusable
      subtitle={
        filtered.length === records.length
          ? `${records.length} total`
          : `${filtered.length} of ${records.length}`
      }
    >
      <div className="roster-controls">
        <div className="roster-tabs" role="group" aria-label="Filter CSPs by status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`filter-chip${status === t.value ? " filter-chip--selected" : ""}`}
              aria-pressed={status === t.value}
              onClick={() => reset(() => setStatus(t.value))}
            >
              {t.label}
              <span className="roster-tab__count">{counts[t.value]}</span>
            </button>
          ))}
        </div>
        <label className="roster-range">
          <span className="roster-range__label">Inactivity range</span>
          <select
            className="roster-range__select"
            value={range}
            onChange={(e) => reset(() => setRange(e.target.value as RangeFilter))}
            aria-label="Filter CSPs by inactivity day range"
          >
            {RANGE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          className="roster-search"
          placeholder="Search CSP code, name, RM, DC, mobile…"
          value={query}
          onChange={(e) => reset(() => setQuery(e.target.value))}
          aria-label="Search CSPs"
        />
      </div>

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
              <th>RM</th>
              <th>RM Email</th>
              <th>RM Mobile</th>
              <th>DC</th>
              <th>DC Email</th>
              <th>DC Mobile</th>
              <th>Last Login</th>
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
                  <td>{r.rmName || "—"}</td>
                  <td>{r.rm?.email || "—"}</td>
                  <td className="num">{r.rm?.mobile || "—"}</td>
                  <td>{r.dcName || "—"}</td>
                  <td>{r.dc?.email || "—"}</td>
                  <td className="num">{r.dc?.mobile || "—"}</td>
                  <td className="num">{r.lastLoginDate ?? "—"}</td>
                  <td>
                    <RowActions record={r} />
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={15} className="empty-state">
                  No CSPs match this filter.
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
        totalCount={filtered.length}
        onPrev={() => setPage(page - 1)}
        onNext={() => setPage(page + 1)}
      />
    </Panel>
  );
}
