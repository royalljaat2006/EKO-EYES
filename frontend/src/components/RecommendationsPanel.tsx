import { useEffect, useMemo, useState } from "react";
import { fetchRecommendations } from "../api/client";
import type { Recommendation } from "../types";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";

const PAGE_SIZE = 25;

/**
 * Rule-based next-action suggestion, not an AI recommendation engine — each
 * entry's reason names the exact rule that produced it (nudge cap reached,
 * or a disclosed repeat-offender count). "Visit" entries surface first.
 */
export default function RecommendationsPanel() {
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchRecommendations()
      .then(setItems)
      .catch(() => setError(true));
  }, []);

  const visits = useMemo(() => (items ?? []).filter((r) => r.category === "visit"), [items]);
  const ordered = useMemo(
    () => (items ? [...visits, ...items.filter((r) => r.category === "call")] : []),
    [items, visits],
  );
  const { page, pageCount, visible, setPage } = usePagination(ordered, PAGE_SIZE);

  if (error) return null;
  if (!items) return null;

  return (
    <Panel
      title="Recommendations"
      subtitle={`${visits.length} recommended for an RM visit · rule-based, not AI-generated`}
    >
      {ordered.length === 0 ? (
        <p className="empty-state empty-state--muted">No currently-inactive CSPs to recommend on.</p>
      ) : (
        <>
          <ul className="reco-list">
            {visible.map((r) => (
              <li key={r.cspCode} className="reco-list__item">
                <span className={`reco-list__tag reco-list__tag--${r.category}`}>
                  {r.category === "visit" ? "Visit" : "Call"}
                </span>
                <span className="reco-list__name">
                  {r.personName} <span style={{ color: "var(--muted)", fontWeight: 400 }}>&middot; {r.rmName || "—"}</span>
                </span>
                <span className="reco-list__days">{r.days}d</span>
                <span className="reco-list__reason">{r.reason}</span>
              </li>
            ))}
          </ul>
          <Pager
            page={page}
            pageCount={pageCount}
            visibleCount={visible.length}
            totalCount={ordered.length}
            onPrev={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
          />
        </>
      )}
    </Panel>
  );
}
