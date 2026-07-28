import { useEffect, useState } from "react";
import { fetchAtRisk } from "../api/client";
import type { AtRiskEntry } from "../types";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";

const PAGE_SIZE = 25;

/**
 * Early warning, NOT machine-learned prediction — currently-healthy CSPs
 * (0-2 days) flagged by two disclosed rules: close to the 3-day threshold,
 * or a relapse history. Each reason names exactly which rule fired.
 */
export default function AtRiskPanel() {
  const [items, setItems] = useState<AtRiskEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchAtRisk()
      .then(setItems)
      .catch(() => setError(true));
  }, []);

  const { page, pageCount, visible, setPage } = usePagination(items ?? [], PAGE_SIZE);

  if (error) return null;
  if (!items) return null;

  return (
    <Panel
      title="At-risk CSPs"
      subtitle={`Early warning, not a prediction — ${items.length} currently-healthy CSPs trending toward inactivity`}
    >
      {items.length === 0 ? (
        <p className="empty-state empty-state--muted">No one currently flagged as at-risk.</p>
      ) : (
        <>
          <ul className="risk-list">
            {visible.map((r) => (
              <li key={r.cspCode} className="risk-list__item">
                <span className="risk-list__name">
                  {r.personName} <span style={{ color: "var(--muted)", fontWeight: 400 }}>&middot; {r.rmName || "—"}</span>
                </span>
                <span className="risk-list__days">{r.days}d</span>
                <span className="risk-list__reason">{r.reason}</span>
              </li>
            ))}
          </ul>
          <Pager
            page={page}
            pageCount={pageCount}
            visibleCount={visible.length}
            totalCount={items.length}
            onPrev={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        </>
      )}
    </Panel>
  );
}
