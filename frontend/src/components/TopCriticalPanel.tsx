import type { InactivityRecord } from "../types";
import { statusOf, STATUS_META } from "../statusOptions";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";
import RowActions from "./RowActions";

const PAGE_SIZE = 20;

interface Props {
  /** Already sorted worst-first by the caller — this component only paginates and renders. */
  records: InactivityRecord[];
}

/** The home dashboard's critical-tier widget — every CSP in the critical tier (30+ days), worst first. */
export default function TopCriticalPanel({ records }: Props) {
  const { page, pageCount, visible, setPage } = usePagination(records, PAGE_SIZE);

  return (
    <Panel
      title="Critical CSPs"
      subtitle={`Worst inactivity streaks, right now · ${records.length} total`}
      focusable
    >
      {records.length === 0 ? (
        <p className="empty-state empty-state--muted">No critical CSPs right now.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>CSP Code</th>
                  <th>CSP Name</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th>RM</th>
                  <th>DC</th>
                  <th>State</th>
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
                      <td>{r.rmName || "—"}</td>
                      <td>{r.dcName || "—"}</td>
                      <td>{r.state || "—"}</td>
                      <td>
                        <RowActions record={r} />
                      </td>
                    </tr>
                  );
                })}
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
        </>
      )}
    </Panel>
  );
}
