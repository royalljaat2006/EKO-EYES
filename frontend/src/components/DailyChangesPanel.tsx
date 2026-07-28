import { useEffect, useState } from "react";
import { fetchDailyChanges } from "../api/client";
import type { DailyChanges } from "../types";
import { usePagination } from "../usePagination";
import Panel from "./Panel";
import Pager from "./Pager";

const PAGE_SIZE = 10;

/** "self" -> "3–7d", "breach" -> "8–15d", etc. — matches the tier-strip's own ranges, no tier names. */
const TIER_LABELS: Record<string, string> = {
  self: "3–7d",
  breach: "8–15d",
  escalated: "16–23d",
  critical: "24+d",
};

function tierLabel(tier: string | null): string {
  if (!tier) return "—";
  return TIER_LABELS[tier] ?? tier;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The named audit trail behind the Trends chart's "recovered vs newly
 * inactive" bars: WHICH CSPs specifically changed status today, not just how
 * many. Backed by dailyChangeLog.service.ts, reviewed daily by dailyJob.ts.
 * Empty until the daily job has actually run today — that's honest, not a bug.
 */
export default function DailyChangesPanel() {
  const [changes, setChanges] = useState<DailyChanges | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchDailyChanges()
      .then(setChanges)
      .catch(() => setError(true));
  }, []);

  const newlyInactive = changes?.newlyInactive ?? [];
  const newCspsAdded = changes?.newCspsAdded ?? [];
  const recovered = changes?.recovered ?? [];
  const onset = usePagination(newlyInactive, PAGE_SIZE);
  const added = usePagination(newCspsAdded, PAGE_SIZE);
  const rec = usePagination(recovered, PAGE_SIZE);

  if (error) return null;
  if (!changes) return null;

  const isEmpty =
    newlyInactive.length === 0 && recovered.length === 0 && newCspsAdded.length === 0;

  return (
    <Panel title="Today’s changes" subtitle="Who specifically went inactive or recovered today">
      {isEmpty ? (
        <p className="empty-state">
          No changes recorded yet today &mdash; this fills in once the daily job has run.
        </p>
      ) : (
        <div className="daily-changes__columns">
          <div className="daily-changes__column">
            <span className="daily-changes__column-title daily-changes__column-title--bad">
              Newly inactive ({newlyInactive.length})
            </span>
            {newlyInactive.length === 0 ? (
              <p className="empty-state empty-state--muted">None today.</p>
            ) : (
              <>
                <ul className="daily-changes__list">
                  {onset.visible.map((e, i) => (
                    <li key={`${e.cspCode}-${i}`} className="daily-changes__item">
                      <span className="daily-changes__item-name">{e.personName}</span>
                      <span className="daily-changes__item-meta">
                        {e.cspCode} &middot; {tierLabel(e.tier)} &middot;{" "}
                        {e.previousDays !== null ? `${e.previousDays}d → ${e.days}d` : `${e.days}d`}{" "}
                        &middot; {formatTime(e.onsetAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                <Pager
                  page={onset.page}
                  pageCount={onset.pageCount}
                  visibleCount={onset.visible.length}
                  totalCount={newlyInactive.length}
                  onPrev={() => onset.setPage(onset.page - 1)}
                  onNext={() => onset.setPage(onset.page + 1)}
                />
              </>
            )}
          </div>

          <div className="daily-changes__column">
            <span className="daily-changes__column-title daily-changes__column-title--good">
              Recovered ({recovered.length})
            </span>
            {recovered.length === 0 ? (
              <p className="empty-state empty-state--muted">None today.</p>
            ) : (
              <>
                <ul className="daily-changes__list">
                  {rec.visible.map((e, i) => (
                    <li key={`${e.personName}-${i}`} className="daily-changes__item">
                      <span className="daily-changes__item-name">{e.personName}</span>
                      <span className="daily-changes__item-meta">
                        was at {tierLabel(e.tierAtRecovery)}
                        {e.daysFlagged !== null && ` · flagged ${e.daysFlagged}d`} &middot;{" "}
                        {formatTime(e.recoveredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
                <Pager
                  page={rec.page}
                  pageCount={rec.pageCount}
                  visibleCount={rec.visible.length}
                  totalCount={recovered.length}
                  onPrev={() => rec.setPage(rec.page - 1)}
                  onNext={() => rec.setPage(rec.page + 1)}
                />
              </>
            )}
          </div>

          {/* Roster additions that arrived ALREADY inactive. Kept out of the
              "newly inactive" count on purpose — nothing changed about these
              people, we just started seeing them, and folding them in would
              make a sheet import look like a mass outbreak. */}
          {newCspsAdded.length > 0 && (
            <div className="daily-changes__column">
              <span className="daily-changes__column-title daily-changes__column-title--neutral">
                New CSPs added ({newCspsAdded.length})
              </span>
              <p className="daily-changes__note">
                Already inactive when they first appeared in the sheet &mdash; not counted as
                today&rsquo;s transitions.
              </p>
              <ul className="daily-changes__list">
                {added.visible.map((e, i) => (
                  <li key={`${e.cspCode}-${i}`} className="daily-changes__item">
                    <span className="daily-changes__item-name">{e.personName}</span>
                    <span className="daily-changes__item-meta">
                      {e.cspCode} &middot; {tierLabel(e.tier)} &middot; {e.days}d &middot;{" "}
                      {formatTime(e.onsetAt)}
                    </span>
                  </li>
                ))}
              </ul>
              <Pager
                page={added.page}
                pageCount={added.pageCount}
                visibleCount={added.visible.length}
                totalCount={newCspsAdded.length}
                onPrev={() => added.setPage(added.page - 1)}
                onNext={() => added.setPage(added.page + 1)}
              />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
