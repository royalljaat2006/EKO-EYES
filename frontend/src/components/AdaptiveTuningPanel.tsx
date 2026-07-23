import { useEffect, useState } from "react";
import { fetchAdaptiveTuning } from "../api/client";
import type { TuningReport } from "../types";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * A bounded, self-referential feedback loop, made visible: each daily run
 * looks at how many nudges CSPs needed before they recovered
 * (adaptiveTuning.service.ts) and moves the CSP_MAX_NUDGES cap by at most
 * one step within a fixed [min, max] range. This panel exists so that loop
 * is never a silent behind-the-scenes change — every evaluation, including
 * "no change," is listed with the reasoning that produced it.
 */
export default function AdaptiveTuningPanel() {
  const [report, setReport] = useState<TuningReport | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchAdaptiveTuning()
      .then(setReport)
      .catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!report) return null;

  const [min, max] = report.bounds;
  const latest = report.history[0];

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Adaptive tuning</h2>
        <span className="panel__subtitle">
          The CSP nudge cap learns from recovery history &mdash; bounded, logged, never silent
        </span>
      </div>

      <div className="tuning-summary">
        <div className="tuning-summary__value">
          <span className="tuning-summary__number">{report.currentValue}</span>
          <span className="tuning-summary__label">
            nudges before hand-off to a human call
            <br />
            (range {min}&ndash;{max} &middot; default {report.defaultValue})
          </span>
        </div>
        {latest && <p className="tuning-summary__reason">{latest.reason}</p>}
      </div>

      {report.history.length === 0 ? (
        <p className="empty-state empty-state--muted">
          No evaluation yet &mdash; this fills in once the daily job has run.
        </p>
      ) : (
        <ul className="tuning-history">
          {report.history.map((h) => (
            <li key={h.id} className="tuning-history__item">
              <span
                className={`tuning-history__delta${h.oldValue === h.newValue ? " tuning-history__delta--none" : h.newValue > h.oldValue ? " tuning-history__delta--up" : " tuning-history__delta--down"}`}
              >
                {h.oldValue === h.newValue ? "no change" : `${h.oldValue} → ${h.newValue}`}
              </span>
              <span className="tuning-history__meta">
                {formatWhen(h.evaluatedAt)} &middot; {h.sampleSize} sample
                {h.sampleSize === 1 ? "" : "s"}
                {h.nearCapShare !== null && h.earlyShare !== null && (
                  <>
                    {" "}
                    &middot; {Math.round(h.nearCapShare * 100)}% at cap, {Math.round(h.earlyShare * 100)}% early
                  </>
                )}
              </span>
              <span className="tuning-history__reason">{h.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
