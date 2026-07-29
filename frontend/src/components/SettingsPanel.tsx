import { useEffect, useState } from "react";
import axios from "axios";
import { fetchSettings, updateSettings } from "../api/client";
import type { AppSettings } from "../types";
import Panel from "./Panel";

type Phase = "loading" | "idle" | "saving" | "saved" | "error";

/** Each numeric field's bounds — the SAME range the API enforces, so the form refuses what the server would refuse anyway. */
const NUMERIC_FIELDS = [
  {
    field: "inactivityThresholdDays",
    icon: "📆",
    label: "Inactivity threshold",
    unit: "days",
    min: 1,
    max: 365,
    step: 1,
    hint: "Days without a transaction before a CSP counts toward the inactivity rate.",
  },
  {
    field: "targetInactivityRate",
    icon: "🎯",
    label: "Target inactivity rate",
    unit: "%",
    min: 0,
    max: 100,
    step: 0.1,
    hint: "The business goal. Every KPI card is measured green or red against this.",
  },
  {
    field: "cspMaxNudges",
    icon: "🔁",
    label: "Max nudges cap",
    unit: "nudges",
    min: 1,
    max: 10,
    step: 1,
    hint: "After this many messages a CSP is handed to a human call instead. Saving this also resets the adaptive tuner to your number.",
  },
  {
    field: "cspNudgeCooldownDays",
    icon: "⏳",
    label: "Nudge cooldown",
    unit: "days",
    min: 1,
    max: 30,
    step: 1,
    hint: "Minimum gap between two messages to the same CSP. 1 means they may be messaged daily.",
  },
] as const satisfies readonly {
  field: keyof AppSettings;
  icon: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}[];

type NumericField = (typeof NUMERIC_FIELDS)[number]["field"];

/** Draft numbers are held as raw strings so a half-typed or cleared field doesn't snap back to 0 mid-edit. */
type Draft = Omit<AppSettings, NumericField> & Record<NumericField, string>;

function toDraft(s: AppSettings): Draft {
  return {
    emailEnabled: s.emailEnabled,
    emailDraftOnly: s.emailDraftOnly,
    whatsappEnabled: s.whatsappEnabled,
    inactivityThresholdDays: String(s.inactivityThresholdDays),
    targetInactivityRate: String(s.targetInactivityRate),
    cspMaxNudges: String(s.cspMaxNudges),
    cspNudgeCooldownDays: String(s.cspNudgeCooldownDays),
  };
}

/** The first out-of-range/blank numeric field, if any — checked before the request so bad input never reaches the server. */
function firstInvalid(draft: Draft): string | null {
  for (const f of NUMERIC_FIELDS) {
    const n = Number(draft[f.field]);
    if (draft[f.field].trim() === "" || !Number.isFinite(n)) {
      return `${f.label} needs a number.`;
    }
    if (n < f.min || n > f.max) {
      return `${f.label} must be between ${f.min} and ${f.max} ${f.unit}.`;
    }
    if (f.step === 1 && !Number.isInteger(n)) {
      return `${f.label} must be a whole number.`;
    }
  }
  return null;
}

/**
 * Operator control over the things that decide WHO gets messaged and how
 * often — including two kill switches that stop outbound email and WhatsApp
 * entirely.
 *
 * The switches are the reason this panel exists. Turning WhatsApp off here
 * stops the daily job AND the manual per-row nudge, not just one of them,
 * so "off" means what it says. Everything is saved server-side (SQLite), so
 * it survives a restart and applies to the scheduled 12 PM run as well as
 * to anything triggered from this dashboard.
 */
export default function SettingsPanel({
  onSaved,
}: {
  /** Lets the shell re-read the settings it mirrors (e.g. the channels-off banner) the moment a save lands. */
  onSaved?: (settings: AppSettings) => void;
}) {
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setSaved(s);
        setDraft(toDraft(s));
        setPhase("idle");
      })
      .catch(() => {
        setPhase("error");
        setMessage("Could not load settings. Confirm the API server is running.");
      });
  }, []);

  const dirty =
    saved !== null &&
    draft !== null &&
    JSON.stringify(draft) !== JSON.stringify(toDraft(saved));

  const setField = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [field]: value } : d));
    // Any edit invalidates the last save's verdict — the checkmark should not
    // linger next to a value that is no longer what the server has.
    setPhase((p) => (p === "saved" || p === "error" ? "idle" : p));
    setMessage(null);
  };

  const save = async () => {
    if (!draft) return;
    const invalid = firstInvalid(draft);
    if (invalid) {
      setPhase("error");
      setMessage(invalid);
      return;
    }

    setPhase("saving");
    setMessage(null);
    try {
      const next = await updateSettings({
        emailEnabled: draft.emailEnabled,
        emailDraftOnly: draft.emailDraftOnly,
        whatsappEnabled: draft.whatsappEnabled,
        inactivityThresholdDays: Number(draft.inactivityThresholdDays),
        targetInactivityRate: Number(draft.targetInactivityRate),
        cspMaxNudges: Number(draft.cspMaxNudges),
        cspNudgeCooldownDays: Number(draft.cspNudgeCooldownDays),
      });
      setSaved(next);
      setDraft(toDraft(next));
      onSaved?.(next);
      setPhase("saved");
      setMessage("Configuration saved. It applies to the next run — no restart needed.");
    } catch (err) {
      setPhase("error");
      setMessage(
        axios.isAxiosError(err) && err.response
          ? `Server rejected the save (${err.response.status}). Check the values and try again.`
          : "Could not reach the API server. Nothing was saved.",
      );
    }
  };

  if (phase === "loading" || !draft) {
    return (
      <Panel title="Settings" subtitle="Runtime configuration — applies without a restart">
        <p className="empty-state empty-state--muted">
          {message ?? "Loading configuration…"}
        </p>
      </Panel>
    );
  }

  const channelsOff = !draft.emailEnabled && !draft.whatsappEnabled;

  return (
    <Panel
      title={
        <>
          <span aria-hidden="true">⚙️</span> Settings
        </>
      }
      subtitle="Runtime configuration — saved server-side, applies to the next run without a restart"
    >
      <div className="settings-grid">
        <ToggleCard
          icon="💬"
          label="WhatsApp alerts"
          checked={draft.whatsappEnabled}
          onChange={(v) => setField("whatsappEnabled", v)}
          hint="Off stops every outbound WhatsApp — the daily job and manual single-CSP nudges alike."
        />
        <ToggleCard
          icon="✉️"
          label="Email alerts"
          checked={draft.emailEnabled}
          onChange={(v) => setField("emailEnabled", v)}
          hint="Off stops every outbound email digest to RMs, DCs, managers and support."
        />
        <ToggleCard
          icon="🧪"
          label="Email draft-only mode"
          checked={draft.emailDraftOnly}
          onChange={(v) => setField("emailDraftOnly", v)}
          highlightWhen="on"
          hint="On: every email is composed exactly as usual — same recipients, templates, wording — but saved as a draft below instead of sent. Nothing reaches a real inbox. Off: the next run sends for real, same plan. Only matters while Email alerts (above) is On."
        />

        {NUMERIC_FIELDS.map((f) => (
          <div className="setting-card" key={f.field}>
            <div className="setting-card__head">
              <span className="setting-card__icon" aria-hidden="true">
                {f.icon}
              </span>
              <span className="setting-card__label">{f.label}</span>
            </div>
            <div className="setting-card__control">
              <input
                className="setting-card__input"
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.step}
                value={draft[f.field]}
                onChange={(e) => setField(f.field, e.target.value)}
              />
              <span className="setting-card__unit">{f.unit}</span>
            </div>
            <p className="setting-card__hint">{f.hint}</p>
          </div>
        ))}
      </div>

      {channelsOff && (
        <p className="settings-warning" role="status">
          ⚠ Both channels are switched off. No CSP, RM or DC will be contacted at all —
          the daily run will still record who is inactive, but will send nothing.
        </p>
      )}

      <div className="form-actions">
        <button
          type="button"
          className={`trigger-button form-save${phase === "saved" && !dirty ? " form-save--ok" : ""}`}
          onClick={save}
          disabled={phase === "saving" || !dirty}
        >
          {phase === "saving" && <span className="form-spinner" aria-hidden="true" />}
          {phase === "saved" && !dirty && <span aria-hidden="true">✓ </span>}
          {phase === "saving" ? "Saving…" : phase === "saved" && !dirty ? "Saved" : "Save configuration"}
        </button>
        {dirty && phase !== "saving" && (
          <button
            type="button"
            className="trigger-button settings-reset"
            onClick={() => {
              if (saved) setDraft(toDraft(saved));
              setPhase("idle");
              setMessage(null);
            }}
          >
            Discard changes
          </button>
        )}
        {message && (
          <span
            className={`form-feedback form-feedback--${phase === "error" ? "error" : "ok"}`}
            role="status"
          >
            {message}
          </span>
        )}
      </div>
    </Panel>
  );
}

function ToggleCard({
  icon,
  label,
  checked,
  onChange,
  hint,
  /**
   * Which state should visually stand out. "off" (default) reddens the card
   * when OFF — right for kill switches, where off is the concerning state.
   * "on" instead ambers the card when ON — right for a mode like draft-only,
   * where ON is the unusual state worth noticing and OFF (normal sending) is
   * perfectly safe.
   */
  highlightWhen = "off",
}: {
  icon: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint: string;
  highlightWhen?: "on" | "off";
}) {
  const highlighted = highlightWhen === "off" ? !checked : checked;
  const highlightClass = highlightWhen === "off" ? "setting-card--off" : "setting-card--active-warn";
  return (
    <div className={`setting-card setting-card--toggle${highlighted ? ` ${highlightClass}` : ""}`}>
      <div className="setting-card__head">
        <span className="setting-card__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="setting-card__label">{label}</span>
      </div>
      <label className="setting-toggle">
        <input
          type="checkbox"
          className="setting-toggle__input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="setting-toggle__track" aria-hidden="true">
          <span className="setting-toggle__thumb" />
        </span>
        <span className={`setting-toggle__state${checked ? " setting-toggle__state--on" : ""}`}>
          {checked ? "On" : "Off"}
        </span>
      </label>
      <p className="setting-card__hint">{hint}</p>
    </div>
  );
}
