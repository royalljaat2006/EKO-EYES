import { useMemo, useState } from "react";
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

type EntityType = "LHO" | "RM" | "DC";

interface Props {
  records: InactivityRecord[];
}

interface Option {
  /** Case-insensitive dedupe key. */
  key: string;
  /** Original casing, as it first appeared in the sheet. */
  label: string;
}

const PICK: Record<EntityType, (r: InactivityRecord) => string> = {
  LHO: (r) => r.lhoName,
  RM: (r) => r.rmName,
  DC: (r) => r.dcName,
};

/**
 * Unique options for a dropdown, deduped case-insensitively — the source sheet
 * has the same LHO spelled with different casing in places (e.g. "Maharashtra"
 * vs "maharashtra"), which would otherwise split one region into two entries.
 */
function optionsFor(records: InactivityRecord[], type: EntityType): Option[] {
  const byKey = new Map<string, Option>();
  for (const r of records) {
    const label = PICK[type](r).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { key, label });
  }
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
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
 * LHO, RM, and DC are picked together — nothing filters until "View results"
 * is pressed, so you can set all three (or just one or two) before opening
 * the popup. Whichever are set are combined with AND: e.g. an LHO + a DC
 * picked together shows only CSPs matching BOTH, not either.
 */
export default function EntityFilterBar({ records }: Props) {
  const [lhoKey, setLhoKey] = useState("");
  const [rmKey, setRmKey] = useState("");
  const [dcKey, setDcKey] = useState("");
  const [viewOpen, setViewOpen] = useState(false);

  const lhoOptions = useMemo(() => optionsFor(records, "LHO"), [records]);
  const rmOptions = useMemo(() => optionsFor(records, "RM"), [records]);
  const dcOptions = useMemo(() => optionsFor(records, "DC"), [records]);

  const lhoLabel = lhoOptions.find((o) => o.key === lhoKey)?.label ?? "";
  const rmLabel = rmOptions.find((o) => o.key === rmKey)?.label ?? "";
  const dcLabel = dcOptions.find((o) => o.key === dcKey)?.label ?? "";

  const anySelected = Boolean(lhoKey || rmKey || dcKey);

  const matches = useMemo(() => {
    if (!anySelected) return [];
    return records
      .filter((r) => {
        if (lhoKey && r.lhoName.trim().toLowerCase() !== lhoKey) return false;
        if (rmKey && r.rmName.trim().toLowerCase() !== rmKey) return false;
        if (dcKey && r.dcName.trim().toLowerCase() !== dcKey) return false;
        return true;
      })
      .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  }, [records, lhoKey, rmKey, dcKey, anySelected]);

  // The popup's chart: inactivity STATUS breakdown (inactive / at-risk /
  // healthy / unmeasurable) for exactly the CSPs matching every filter picked —
  // same vocabulary as the All CSPs table, so the two views agree.
  const statusChartData: StatusDatum[] = useMemo(
    () =>
      STATUS_ORDER.map((s) => ({
        label: STATUS_META[s].label,
        count: matches.filter((r) => statusOf(r) === s).length,
        color: STATUS_META[s].color,
      })),
    [matches],
  );

  const criteriaLabel = [
    lhoLabel && `LHO: ${lhoLabel}`,
    rmLabel && `RM: ${rmLabel}`,
    dcLabel && `DC: ${dcLabel}`,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const clearAll = () => {
    setLhoKey("");
    setRmKey("");
    setDcKey("");
  };

  const close = () => setViewOpen(false);

  return (
    <>
      <div className="entity-filter-bar" role="group" aria-label="Filter CSPs by LHO, RM, and DC together">
        <label className="entity-filter">
          <span className="entity-filter__label">LHO</span>
          <select value={lhoKey} onChange={(e) => setLhoKey(e.target.value)} aria-label="LHO">
            <option value="">Select an LHO&hellip; ({lhoOptions.length})</option>
            {lhoOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="entity-filter">
          <span className="entity-filter__label">RM</span>
          <select value={rmKey} onChange={(e) => setRmKey(e.target.value)} aria-label="RM">
            <option value="">Select a RM&hellip; ({rmOptions.length})</option>
            {rmOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="entity-filter">
          <span className="entity-filter__label">DC</span>
          <select value={dcKey} onChange={(e) => setDcKey(e.target.value)} aria-label="DC">
            <option value="">Select a DC&hellip; ({dcOptions.length})</option>
            {dcOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="entity-filter__actions">
          <button
            type="button"
            className="trigger-button trigger-button--confirm"
            disabled={!anySelected}
            onClick={() => setViewOpen(true)}
          >
            View results
          </button>
          {anySelected && (
            <button type="button" className="entity-filter__clear" onClick={clearAll}>
              Clear
            </button>
          )}
        </div>
      </div>

      {viewOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={criteriaLabel}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="modal modal--wide">
            <div className="modal__header-row">
              <h3>{criteriaLabel}</h3>
              <button type="button" className="modal__close" onClick={close} aria-label="Close">
                &#10005;
              </button>
            </div>
            <p className="modal__hint">
              {matches.length} CSP{matches.length === 1 ? "" : "s"}
            </p>

            {matches.length > 0 && (
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

            <div className="table-scroll modal__table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>CSP Code</th>
                    <th>CSP Name</th>
                    <th>Days</th>
                    <th>Terminal</th>
                    <th>CSP Mobile</th>
                    <th>LHO</th>
                    <th>RM</th>
                    <th>DC</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((r, i) => (
                    <tr key={r.sourceRow}>
                      <td className="num">{i + 1}</td>
                      <td className="num">{r.cspCode || "—"}</td>
                      <td>{r.targetPersonName}</td>
                      <td className="num">{r.days ?? "—"}</td>
                      <td>{r.terminalStatus || "—"}</td>
                      <td className="num">{r.cspMobile || "—"}</td>
                      <td>{r.lhoName || "—"}</td>
                      <td>{r.rmName || "—"}</td>
                      <td>{r.dcName || "—"}</td>
                    </tr>
                  ))}
                  {matches.length === 0 && (
                    <tr>
                      <td colSpan={9} className="empty-state">
                        No CSPs match this combination.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal__actions">
              <button type="button" className="trigger-button" onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
