import type { InactivityRecord } from "../types";
import { isPlaceholderAssignee } from "../utils/placeholder";
import { statusOf, STATUS_META } from "../statusOptions";
import Panel from "./Panel";
import RowActions from "./RowActions";

interface Props {
  records: InactivityRecord[];
  thresholdLabel: string;
}

/**
 * A CSP whose RM or DC has no contact on file cannot be alerted at all — EXCEPT
 * when that role is "TBA" in the sheet, which means intentionally unassigned.
 * The backend skips TBA silently rather than treating it as a failure, so the
 * dashboard shouldn't flag it as one either.
 */
function reachability(r: InactivityRecord): { label: string; className: string; icon: string } {
  const dcIsTba = isPlaceholderAssignee(r.dcName);
  const missing: string[] = [];
  if (!r.rm) missing.push("RM");
  if (!r.dc && !dcIsTba) missing.push("DC");
  if (missing.length === 0) {
    return dcIsTba
      ? { label: "Reachable (DC: TBA)", className: "status--delivered", icon: "✓" }
      : { label: "Reachable", className: "status--delivered", icon: "✓" };
  }
  if (missing.length === 2) return { label: "No contacts", className: "status--failed", icon: "✕" };
  return { label: `No ${missing[0]}`, className: "status--partial", icon: "!" };
}

export default function DataTable({ records, thresholdLabel }: Props) {
  return (
    <Panel
      title="Inactive CSPs"
      focusable
      subtitle={`${thresholdLabel} · ${records.length} CSP${records.length === 1 ? "" : "s"}`}
    >
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
              <th>Alertable</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => {
              const reach = reachability(r);
              const pill = STATUS_META[statusOf(r)];
              return (
                <tr key={r.sourceRow}>
                  <td className="num">{i + 1}</td>
                  <td className="num">{r.cspCode}</td>
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
                    <span className={`status-pill ${reach.className}`}>
                      <span aria-hidden="true">{reach.icon}</span> {reach.label}
                    </span>
                  </td>
                  <td>
                    <RowActions record={r} />
                  </td>
                </tr>
              );
            })}
            {records.length === 0 && (
              <tr>
                <td colSpan={16} className="empty-state">
                  No inactive CSPs at this threshold.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
