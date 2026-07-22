import { useEffect, useState } from "react";
import { fetchDailyChanges } from "../api/client";
import type { DailyChanges } from "../types";

/** "self" -> "Self-nudge", "breach" -> "RM follow-up", etc. — matches the tier-strip's own labels. */
const TIER_LABELS: Record<string, string> = {
  self: "Self-nudge",
  breach: "RM follow-up",
  escalated: "RM + DC",
  critical: "Critical",
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

  if (error) return null;
  if (!changes) return null;

  const { newlyInactive, recovered } = changes;
  const isEmpty = newlyInactive.length === 0 && recovered.length === 0;

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Today&rsquo;s changes</h2>
        <span className="panel__subtitle">Who specifically went inactive or recovered today</span>
      </div>

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
              <ul className="daily-changes__list">
                {newlyInactive.map((e, i) => (
                  <li key={`${e.cspCode}-${i}`} className="daily-changes__item">
                    <span className="daily-changes__item-name">{e.personName}</span>
                    <span className="daily-changes__item-meta">
                      {e.cspCode} &middot; {tierLabel(e.tier)} &middot; {e.days}d &middot; {formatTime(e.onsetAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="daily-changes__column">
            <span className="daily-changes__column-title daily-changes__column-title--good">
              Recovered ({recovered.length})
            </span>
            {recovered.length === 0 ? (
              <p className="empty-state empty-state--muted">None today.</p>
            ) : (
              <ul className="daily-changes__list">
                {recovered.map((e, i) => (
                  <li key={`${e.personName}-${i}`} className="daily-changes__item">
                    <span className="daily-changes__item-name">{e.personName}</span>
                    <span className="daily-changes__item-meta">
                      was {tierLabel(e.tierAtRecovery)}
                      {e.daysFlagged !== null && ` · flagged ${e.daysFlagged}d`} &middot;{" "}
                      {formatTime(e.recoveredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
