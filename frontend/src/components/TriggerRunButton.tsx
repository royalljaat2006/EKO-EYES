import { useState } from "react";
import { triggerDailyJob } from "../api/client";
import type { DailyJobResult } from "../types";

type Phase = "idle" | "confirm" | "running" | "result" | "error";

interface Props {
  /** Called after a run completes successfully, so the dashboard can refresh. */
  onComplete?: () => void;
}

/**
 * Manually fires the same ingest -> evaluate -> notify pipeline that runs on
 * the daily schedule. This sends REAL email/WhatsApp messages to whoever is
 * due today (CSPs, RMs, DCs) — so it is gated behind an explicit confirmation
 * step rather than firing on a single click.
 */
export default function TriggerRunButton({ onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<DailyJobResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const run = async () => {
    setPhase("running");
    try {
      const res = await triggerDailyJob();
      setResult(res);
      setPhase("result");
      onComplete?.();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to trigger the run. Confirm the API server is running.",
      );
      setPhase("error");
    }
  };

  const close = () => {
    if (phase === "running") return; // don't let a run be dismissed mid-flight
    setPhase("idle");
    setResult(null);
    setErrorMsg(null);
  };

  const sent = result ? result.notifications.filter((n) => n.success).length : 0;
  const failed = result ? result.notifications.filter((n) => !n.success).length : 0;

  return (
    <>
      <button type="button" className="trigger-button" onClick={() => setPhase("confirm")}>
        <span aria-hidden="true">▶</span> Run alerts now
      </button>

      {phase !== "idle" && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Run alerts now"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="modal">
            {phase === "confirm" && (
              <>
                <h3>Send real alerts now?</h3>
                <p>
                  This runs the full pipeline immediately: it re-reads the live spreadsheet,
                  evaluates every CSP against the escalation tiers, and sends real email and
                  WhatsApp messages to whoever is due today — CSPs, RMs, and DCs.
                </p>
                <p className="modal__warn">
                  This is the same action that runs automatically on the daily schedule. It cannot
                  be undone once messages are sent.
                </p>
                <div className="modal__actions">
                  <button type="button" className="pager__button" onClick={close}>
                    Cancel
                  </button>
                  <button type="button" className="trigger-button trigger-button--confirm" onClick={run}>
                    Yes, send now
                  </button>
                </div>
              </>
            )}

            {phase === "running" && (
              <>
                <h3>Running&hellip;</h3>
                <p>
                  Ingesting the spreadsheet and sending alerts. This can take a moment for the full
                  roster — please don&rsquo;t close this.
                </p>
              </>
            )}

            {phase === "result" && result && (
              <>
                <h3>Run complete</h3>
                <div className="delivery-stats">
                  <div className="delivery-stat">
                    <span className="delivery-stat__value">{result.totalRecordsIngested}</span>
                    <span className="delivery-stat__label">CSPs ingested</span>
                  </div>
                  <div className="delivery-stat">
                    <span className="delivery-stat__value">{result.totalAlertsMatched}</span>
                    <span className="delivery-stat__label">Alerted on</span>
                  </div>
                  <div className="delivery-stat">
                    <span className="delivery-stat__value delivery-stat__value--good">{sent}</span>
                    <span className="delivery-stat__label">Messages sent</span>
                  </div>
                  <div className="delivery-stat">
                    <span
                      className={`delivery-stat__value${failed > 0 ? " delivery-stat__value--bad" : ""}`}
                    >
                      {failed}
                    </span>
                    <span className="delivery-stat__label">Failed</span>
                  </div>
                </div>
                <p className="modal__hint">
                  See the &ldquo;Alert delivery&rdquo; panel below for exactly who was messaged and
                  what failed.
                </p>
                <div className="modal__actions">
                  <button type="button" className="trigger-button" onClick={close}>
                    Close
                  </button>
                </div>
              </>
            )}

            {phase === "error" && (
              <>
                <h3>Run failed</h3>
                <p className="modal__warn">{errorMsg}</p>
                <div className="modal__actions">
                  <button type="button" className="trigger-button" onClick={close}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
