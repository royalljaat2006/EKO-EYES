import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { fetchTemplates, resetTemplate, updateTemplates } from "../api/client";
import type { EffectiveTemplate } from "../types";
import Panel from "./Panel";

type Phase = "loading" | "idle" | "saving" | "saved" | "error";

/** `{{token}}` substitution mirroring the backend's renderTemplate — used only for the live preview, never sent anywhere. */
function renderPreview(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template,
  );
}

/** Which required placeholders (if any) `value` is missing — same rule the server enforces on save. */
function missingPlaceholders(t: EffectiveTemplate, value: string): string[] {
  return t.requiredPlaceholders.filter((token) => !value.includes(token));
}

/**
 * Every outbound message's wording, editable from the dashboard.
 *
 * WhatsApp templates carry a hard caveat that this panel must never hide:
 * Goinfinito/Meta send through an APPROVED business template, so only the
 * placeholder VALUES (name, CSP code, days) reach the recipient on that
 * channel — the surrounding sentence is fixed by Meta's approval. Editing it
 * here still updates what this app stores and previews, and takes full
 * effect on channels that send raw text (e.g. Twilio), but will not change
 * the actual WhatsApp wording a CSP/RM/DC sees while Goinfinito/Meta is the
 * active provider.
 */
export default function TemplatesPanel() {
  const [templates, setTemplates] = useState<EffectiveTemplate[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = () => {
    setPhase("loading");
    fetchTemplates()
      .then((list) => {
        setTemplates(list);
        setDrafts(Object.fromEntries(list.map((t) => [t.key, t.value])));
        setPhase("idle");
      })
      .catch(() => {
        setPhase("error");
        setMessage("Could not load templates. Confirm the API server is running.");
      });
  };

  useEffect(load, []);

  const byChannel = useMemo(() => {
    const email = (templates ?? []).filter((t) => t.channel === "email");
    const whatsapp = (templates ?? []).filter((t) => t.channel === "whatsapp");
    return { email, whatsapp };
  }, [templates]);

  const dirtyKeys = useMemo(
    () => (templates ?? []).filter((t) => drafts[t.key] !== t.value).map((t) => t.key),
    [templates, drafts],
  );

  const setDraft = (key: string, value: string) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
    setPhase((p) => (p === "saved" || p === "error" ? "idle" : p));
    setMessage(null);
  };

  const discard = (t: EffectiveTemplate) => setDraft(t.key, t.value);

  const save = async () => {
    if (!templates || dirtyKeys.length === 0) return;

    // Pre-check every dirty template client-side so one clearly-labelled
    // field error shows up instead of a single generic 400 from the server.
    const errors: Record<string, string> = {};
    for (const key of dirtyKeys) {
      const t = templates.find((x) => x.key === key)!;
      const missing = missingPlaceholders(t, drafts[key]);
      if (missing.length > 0) {
        errors[key] = `Missing required placeholder${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setPhase("error");
      setMessage("Fix the highlighted template(s) before saving — a required placeholder is missing.");
      return;
    }

    setPhase("saving");
    setMessage(null);
    try {
      const patch = Object.fromEntries(dirtyKeys.map((k) => [k, drafts[k]]));
      const saved = await updateTemplates(patch);
      setTemplates(saved);
      setDrafts(Object.fromEntries(saved.map((t) => [t.key, t.value])));
      setPhase("saved");
      setMessage("Templates saved. Takes effect on the next message sent — no restart needed.");
    } catch (err) {
      setPhase("error");
      setMessage(
        axios.isAxiosError(err) && err.response?.data?.error
          ? typeof err.response.data.error === "string"
            ? err.response.data.error
            : "Server rejected the save — check the values and try again."
          : "Could not reach the API server. Nothing was saved.",
      );
    }
  };

  const doReset = async (key: string) => {
    try {
      const saved = await resetTemplate(key);
      setTemplates(saved);
      setDrafts(Object.fromEntries(saved.map((t) => [t.key, t.value])));
    } catch {
      setMessage("Could not reset this template. Confirm the API server is running.");
      setPhase("error");
    }
  };

  if (phase === "loading" || !templates) {
    return (
      <Panel title="Message templates" subtitle="Every outbound message's wording — editable, versioned server-side">
        <p className="empty-state empty-state--muted">{message ?? "Loading templates…"}</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={
        <>
          <span aria-hidden="true">📝</span> Message templates
        </>
      }
      subtitle="Every outbound message's wording — editable, saved server-side, no redeploy needed"
    >
      <div className="templates-section">
        <h3 className="templates-section__title">Email</h3>
        <p className="templates-section__note">
          Takes full effect immediately — no approval process, no caveats.
        </p>
        <div className="templates-grid">
          {byChannel.email.map((t) => (
            <TemplateCard
              key={t.key}
              def={t}
              draft={drafts[t.key] ?? t.value}
              error={fieldErrors[t.key]}
              onChange={(v) => setDraft(t.key, v)}
              onDiscard={() => discard(t)}
              onReset={() => doReset(t.key)}
              dirty={drafts[t.key] !== t.value}
            />
          ))}
        </div>
      </div>

      <div className="templates-section">
        <h3 className="templates-section__title">WhatsApp</h3>
        <p className="templates-section__note templates-section__note--warning">
          ⚠ Sent through Meta&rsquo;s <strong>approved business template</strong>. Only the placeholder{" "}
          <em>values</em> (name, CSP code, days) reach the recipient on Goinfinito/Meta — the surrounding
          sentence is fixed by that approval and editing it here will not change the real WhatsApp wording
          while that provider is active. It DOES take full effect on a raw-text provider (e.g. Twilio), and
          always updates what this dashboard stores/previews.
        </p>
        <div className="templates-grid">
          {byChannel.whatsapp.map((t) => (
            <TemplateCard
              key={t.key}
              def={t}
              draft={drafts[t.key] ?? t.value}
              error={fieldErrors[t.key]}
              onChange={(v) => setDraft(t.key, v)}
              onDiscard={() => discard(t)}
              onReset={() => doReset(t.key)}
              dirty={drafts[t.key] !== t.value}
            />
          ))}
        </div>
      </div>

      <div className="settings-actions">
        <button
          type="button"
          className={`trigger-button settings-save${phase === "saved" && dirtyKeys.length === 0 ? " settings-save--ok" : ""}`}
          onClick={save}
          disabled={phase === "saving" || dirtyKeys.length === 0}
        >
          {phase === "saving" && <span className="settings-spinner" aria-hidden="true" />}
          {phase === "saved" && dirtyKeys.length === 0 && <span aria-hidden="true">✓ </span>}
          {phase === "saving"
            ? "Saving…"
            : phase === "saved" && dirtyKeys.length === 0
              ? "Saved"
              : dirtyKeys.length > 0
                ? `Save ${dirtyKeys.length} template${dirtyKeys.length > 1 ? "s" : ""}`
                : "Save changes"}
        </button>
        {message && (
          <span className={`settings-feedback settings-feedback--${phase === "error" ? "error" : "ok"}`} role="status">
            {message}
          </span>
        )}
      </div>
    </Panel>
  );
}

function TemplateCard({
  def,
  draft,
  error,
  dirty,
  onChange,
  onDiscard,
  onReset,
}: {
  def: EffectiveTemplate;
  draft: string;
  error?: string;
  dirty: boolean;
  onChange: (v: string) => void;
  onDiscard: () => void;
  onReset: () => void;
}) {
  const preview = renderPreview(draft, def.sampleVars);
  const missing = missingPlaceholders(def, draft);

  return (
    <div className={`template-card${error ? " template-card--error" : ""}`}>
      <div className="template-card__head">
        <span className="template-card__label">{def.label}</span>
        {def.isCustomized && <span className="template-card__badge">Customized</span>}
      </div>
      <p className="template-card__desc">{def.description}</p>

      <textarea
        className="template-card__textarea"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        spellCheck={false}
      />

      {def.requiredPlaceholders.length > 0 && (
        <div className="template-card__placeholders">
          Required:{" "}
          {def.requiredPlaceholders.map((p) => (
            <code
              key={p}
              className={`template-card__token${missing.includes(p) ? " template-card__token--missing" : ""}`}
            >
              {p}
            </code>
          ))}
        </div>
      )}

      {error && <p className="template-card__field-error">{error}</p>}

      <div className="template-card__preview">
        <span className="template-card__preview-label">Preview (sample data)</span>
        <p className="template-card__preview-text">{preview}</p>
      </div>

      <div className="template-card__actions">
        {dirty && (
          <button type="button" className="link-button" onClick={onDiscard}>
            Discard edit
          </button>
        )}
        {def.isCustomized && (
          <button type="button" className="link-button" onClick={onReset}>
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}
