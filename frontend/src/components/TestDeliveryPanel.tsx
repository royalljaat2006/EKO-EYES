import { useState } from "react";
import { runTestDelivery } from "../api/client";
import type { TestChannelResult, TestDeliveryResult } from "../types";

type Phase = "idle" | "running" | "done" | "error";

/**
 * A standalone delivery test. It sends a sample email and/or WhatsApp to a
 * contact you choose and reports whether each channel actually landed — nothing
 * more. It never reads the spreadsheet, evaluates tiers, or messages a real
 * CSP/RM/DC, so it is safe to run any time to confirm the credentials work.
 *
 * This is separate from "Run alerts now" and the daily schedule, which are
 * unchanged: they still send the real alerts to the real recipients.
 */
export default function TestDeliveryPanel() {
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<TestDeliveryResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canSend = email.trim() !== "" || mobile.trim() !== "";

  const send = async () => {
    if (!canSend) return;
    setPhase("running");
    setErrorMsg(null);
    try {
      const res = await runTestDelivery(email.trim(), mobile.trim());
      setResult(res);
      setPhase("done");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Test failed. Confirm the API server is running.",
      );
      setPhase("error");
    }
  };

  return (
    <section className="panel test-panel">
      <div className="panel__header">
        <h2>
          <span aria-hidden="true">🧪</span> Test delivery
        </h2>
        <span className="test-panel__tag">Diagnostic only — no CSP/RM/DC is contacted</span>
      </div>
      <p className="test-panel__intro">
        Send a sample message to a contact of your choice to confirm email and WhatsApp delivery are
        working. This does not read the spreadsheet or send any real alerts — use it whenever you
        want to check delivery status. The daily 12&nbsp;PM run and &ldquo;Run alerts now&rdquo; are
        unaffected.
      </p>

      <div className="test-panel__form">
        <label>
          Test email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Test mobile
          <input
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="9876543210"
          />
        </label>
        <button
          type="button"
          className="trigger-button trigger-button--confirm"
          onClick={send}
          disabled={!canSend || phase === "running"}
        >
          {phase === "running" ? "Sending…" : "Send test"}
        </button>
      </div>
      <p className="test-panel__hint">Fill in either field, or both. A 10-digit mobile is treated as Indian (+91).</p>

      {phase === "error" && <div className="error-banner">{errorMsg}</div>}

      {phase === "done" && result && (
        <div className="test-panel__results">
          <ChannelResult label="Email" res={result.email} />
          <ChannelResult label="WhatsApp" res={result.whatsapp} />
        </div>
      )}
    </section>
  );
}

function ChannelResult({ label, res }: { label: string; res: TestChannelResult }) {
  if (!res.attempted) {
    return (
      <div className="test-result test-result--skipped">
        <span className="test-result__channel">{label}</span>
        <span className="test-result__status">Not tested (no contact given)</span>
      </div>
    );
  }
  return (
    <div className={`test-result ${res.success ? "test-result--ok" : "test-result--fail"}`}>
      <span className="test-result__channel">
        {res.success ? "✓" : "✕"} {label}
      </span>
      <span className="test-result__status">
        {res.success ? "Delivered" : `Failed: ${res.error ?? "unknown error"}`}
      </span>
    </div>
  );
}
