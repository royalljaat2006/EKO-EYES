import { useState } from "react";
import type { InactivityRecord } from "../types";
import { triggerOneOffNudge } from "../api/client";

type NudgePhase = "idle" | "confirm" | "sending" | "result";

interface Props {
  record: InactivityRecord;
}

/**
 * The three row-level shortcuts: copy the CSP's mobile number (clipboard
 * only, no risk), view their RM/DC contact card (read-only popover), and
 * send a one-off nudge (a REAL WhatsApp send — gated behind its own
 * confirm step, same pattern as TriggerRunButton's "Run alerts now").
 */
export default function RowActions({ record }: Props) {
  const [showContact, setShowContact] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nudgePhase, setNudgePhase] = useState<NudgePhase>("idle");
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  const [nudgeOk, setNudgeOk] = useState(false);

  const copyMobile = async () => {
    if (!record.cspMobile) return;
    try {
      await navigator.clipboard.writeText(record.cspMobile);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently no-op, nothing to recover.
    }
  };

  const closeNudge = () => {
    if (nudgePhase === "sending") return; // don't dismiss mid-send
    setNudgePhase("idle");
    setNudgeError(null);
    setNudgeOk(false);
  };

  const sendNudge = async () => {
    setNudgePhase("sending");
    const result = await triggerOneOffNudge(record.cspCode);
    setNudgeOk(result.success);
    setNudgeError(result.success ? null : result.error ?? "Failed to send.");
    setNudgePhase("result");
  };

  return (
    <div className="row-actions">
      <button
        type="button"
        className="row-actions__btn"
        title={record.cspMobile ? "Copy mobile number" : "No mobile on file"}
        onClick={copyMobile}
        disabled={!record.cspMobile}
      >
        {copied ? "✓" : "📋"}
      </button>
      <button
        type="button"
        className="row-actions__btn"
        title="View RM/DC contact card"
        onClick={() => setShowContact(true)}
      >
        🔍
      </button>
      <button
        type="button"
        className="row-actions__btn"
        title="Send a one-off nudge now"
        onClick={() => setNudgePhase("confirm")}
      >
        💬
      </button>

      {showContact && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Contact card"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowContact(false);
          }}
        >
          <div className="modal">
            <h3>{record.targetPersonName}</h3>
            <div className="contact-card">
              <div className="contact-card__row">
                <span className="contact-card__role">RM</span>
                <span className="contact-card__name">{record.rmName || "—"}</span>
                <span className="contact-card__detail">{record.rm?.email || "no email"}</span>
                <span className="contact-card__detail">{record.rm?.mobile || "no mobile"}</span>
              </div>
              <div className="contact-card__row">
                <span className="contact-card__role">DC</span>
                <span className="contact-card__name">{record.dcName || "—"}</span>
                <span className="contact-card__detail">{record.dc?.email || "no email"}</span>
                <span className="contact-card__detail">{record.dc?.mobile || "no mobile"}</span>
              </div>
            </div>
            <div className="modal__actions">
              <button type="button" className="trigger-button" onClick={() => setShowContact(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {nudgePhase !== "idle" && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Send one-off nudge"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeNudge();
          }}
        >
          <div className="modal">
            {nudgePhase === "confirm" && (
              <>
                <h3>Send a one-off nudge now?</h3>
                <p>
                  This sends a REAL WhatsApp message to <strong>{record.targetPersonName}</strong> (
                  {record.cspCode}) right now, bypassing the normal cooldown and nudge cap. Terminal-active
                  and stop-request checks still apply.
                </p>
                <p className="modal__warn">This cannot be undone once sent.</p>
                <div className="modal__actions">
                  <button type="button" className="pager__button" onClick={closeNudge}>
                    Cancel
                  </button>
                  <button type="button" className="trigger-button trigger-button--confirm" onClick={sendNudge}>
                    Yes, send now
                  </button>
                </div>
              </>
            )}
            {nudgePhase === "sending" && <p>Sending&hellip;</p>}
            {nudgePhase === "result" && (
              <>
                <h3>{nudgeOk ? "Sent" : "Not sent"}</h3>
                <p className={nudgeOk ? undefined : "modal__warn"}>
                  {nudgeOk ? `WhatsApp sent to ${record.targetPersonName}.` : nudgeError}
                </p>
                <div className="modal__actions">
                  <button type="button" className="trigger-button" onClick={closeNudge}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
