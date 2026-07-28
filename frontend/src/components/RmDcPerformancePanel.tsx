import { useEffect, useState } from "react";
import { fetchRmDcPerformance } from "../api/client";
import type { PerformanceEntry, RmDcPerformance } from "../types";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";

type Role = "rm" | "dc";

const PAGE_SIZE = 15;

/**
 * Per-RM/DC recovery performance — pure arithmetic over recovery_log + the
 * roster (recovered count, average days-to-recovery, an efficiency % using
 * the same recipe as the global recoveryRate). No AI scoring; explicitly
 * scoped out for this pass.
 */
export default function RmDcPerformancePanel() {
  const [data, setData] = useState<RmDcPerformance | null>(null);
  const [role, setRole] = useState<Role>("rm");
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchRmDcPerformance()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const { page, pageCount, visible, setPage, resetPage } = usePagination(data ? data[role] : [], PAGE_SIZE);

  // Switching RM <-> DC swaps to a different array entirely — start back at page 1.
  useEffect(() => {
    resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  if (error) return null;
  if (!data) return null;

  return (
    <Panel
      title="RM / DC performance"
      focusable
      subtitle="Recovered in the last 30 days, average days-to-recovery, and efficiency (recovered ÷ (recovered + currently inactive))"
      headerExtra={
        <div className="chart-controls">
          <div className="chart-controls__group" role="group" aria-label="Performance role">
            <button
              type="button"
              className={`chart-controls__btn${role === "rm" ? " chart-controls__btn--active" : ""}`}
              onClick={() => setRole("rm")}
            >
              RM
            </button>
            <button
              type="button"
              className={`chart-controls__btn${role === "dc" ? " chart-controls__btn--active" : ""}`}
              onClick={() => setRole("dc")}
            >
              DC
            </button>
          </div>
        </div>
      }
    >
      {data[role].length === 0 ? (
        <p className="empty-state empty-state--muted">No {role.toUpperCase()} data yet.</p>
      ) : (
        <>
          <div className="perf-table">
            <div className="perf-table__head">
              <span>{role === "rm" ? "RM" : "DC"}</span>
              <span>Currently inactive</span>
              <span>Recovered (30d)</span>
              <span>Avg days to recover</span>
              <span>Efficiency</span>
            </div>
            {visible.map((p: PerformanceEntry) => (
              <div className="perf-table__row" key={p.key}>
                <span className="perf-table__name">{p.label}</span>
                <span>{p.currentlyInactive}</span>
                <span>{p.recovered}</span>
                <span>{p.avgRecoveryDays === null ? "—" : `${p.avgRecoveryDays}d`}</span>
                <span
                  className={`perf-table__efficiency${p.efficiency >= 50 ? " perf-table__efficiency--good" : p.efficiency > 0 ? " perf-table__efficiency--warn" : ""}`}
                >
                  {p.efficiency}%
                </span>
              </div>
            ))}
          </div>
          <Pager
            page={page}
            pageCount={pageCount}
            visibleCount={visible.length}
            totalCount={data[role].length}
            onPrev={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        </>
      )}
    </Panel>
  );
}
