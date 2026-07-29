import db from "./alertStore.service";

/**
 * Editable copy for every outbound message the system sends — an operator
 * can reword these from the dashboard without a code change or a redeploy.
 *
 * IMPORTANT — read before exposing a new template as "freely editable":
 * WhatsApp goes out through an APPROVED business template (Goinfinito,
 * template ID 1778199 — see goinfinitoWhatsApp.provider.ts). Meta's approval
 * process fixes the surrounding sentence structure the recipient actually
 * sees; only the 3 variable slots (name, CSP code, days) are truly per-message
 * editable on that channel. Editing `cspWhatsapp`/`roleCspWhatsapp` here still
 * changes what THIS APP stores/previews and — for a raw-text-capable channel
 * like Twilio — what actually gets sent, but on the Goinfinito/Meta approved-
 * template path the wording change has no visible effect on the real message;
 * only stored for the dashboard's own record and possible future providers.
 * `channel: "whatsapp"` templates carry `approvalLocked: true` for exactly
 * this reason — the frontend must show that caveat, not hide it.
 *
 * Email has no such constraint: `channel: "email"` templates take full,
 * immediate effect on the next real send.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

export type TemplateChannel = "email" | "whatsapp";

export interface TemplateDefinition {
  key: string;
  label: string;
  description: string;
  channel: TemplateChannel;
  /** Tokens the rendered value MUST still contain after any edit — enforced on save. */
  requiredPlaceholders: string[];
  /** Sample data for the frontend's live preview. */
  sampleVars: Record<string, string>;
  /** Present + true only for whatsapp templates — see the file-level note above. */
  approvalLocked?: boolean;
  defaultValue: string;
}

/** The full registry. Add a new template here — everything else (storage, API, validation) is generic. */
export const TEMPLATE_DEFS: TemplateDefinition[] = [
  {
    key: "cspWhatsapp",
    label: "CSP WhatsApp nudge",
    description:
      "Sent directly to the CSP once they're 3+ days inactive. Help-first tone, never a threat — see SKILLS.md.",
    channel: "whatsapp",
    approvalLocked: true,
    requiredPlaceholders: ["{{name}}", "{{cspCode}}", "{{days}}"],
    sampleVars: { name: "Ram Kumar", cspCode: "1A850247", days: "5" },
    defaultValue:
      "Hello {{name}}, we noticed your CSP terminal ({{cspCode}}) has not been used for {{days}} days. " +
      "Is everything OK? If you are facing any issue — device problem, shop closed, or anything else — " +
      "reply HELP and our team will call you. If all is well, a single transaction today will bring your terminal back to active.",
  },
  {
    key: "roleCspWhatsapp",
    label: "RM/DC per-CSP WhatsApp",
    description:
      "Sent to the RM or DC, once per CSP they're responsible for (the approved template is single-CSP, so an aggregate summary can't fit on WhatsApp — the full list still goes in their email digest).",
    channel: "whatsapp",
    approvalLocked: true,
    requiredPlaceholders: ["{{recipientName}}", "{{cspCode}}", "{{days}}"],
    sampleVars: { recipientName: "Vandana", cspCode: "1A850247", days: "5" },
    defaultValue:
      "Hello {{recipientName}}, we noticed your CSP terminal ({{cspCode}}) has not been used for {{days}} days.",
  },
  {
    key: "emailDigestSubject",
    label: "Email digest subject line",
    description: "The subject line of the consolidated inactivity digest email sent to RM/DC/Manager/Leadership/Support.",
    channel: "email",
    requiredPlaceholders: ["{{role}}"],
    sampleVars: { role: "RM" },
    defaultValue: "Action required: inactivity digest ({{role}})",
  },
  {
    key: "rmEmailBody",
    label: "RM email — full body",
    description:
      "The whole digest email sent to an RM (from day 7, once they're responsible for at least one inactive CSP). " +
      "{{cspList}} is where the day-by-day CSP breakdown is inserted automatically — reword everything around it freely, but the token itself must stay, or the RM's actual CSP list disappears from the email.",
    channel: "email",
    requiredPlaceholders: ["{{cspList}}"],
    sampleVars: {
      count: "2",
      targetRate: "2",
      cspList:
        "RM FOLLOW-UP — Inactive 7+ days — RM follow-up required\n  • Ram Kumar (1A850247) — 9 days inactive\n  • Sita Devi (1A850391) — 12 days inactive",
    },
    defaultValue:
      "Inactivity digest for you as Relationship Manager. {{count}} CSP(s) under you need attention.\n\n" +
      "{{cspList}}\n\n" +
      "Target: keep inactivity at or below {{targetRate}}%.\n\n" +
      "-- E.Y.E.S. (EKO Yield & Escalation System)",
  },
  {
    key: "dcEmailBody",
    label: "DC email — full body",
    description:
      "The whole digest email sent to a DC (from day 15 they're WhatsApp-only; this EMAIL only starts once one of their CSPs reaches day 30/critical). " +
      "{{cspList}} is where the day-by-day CSP breakdown is inserted automatically — reword everything around it freely, but the token itself must stay, or the DC's actual CSP list disappears from the email.",
    channel: "email",
    requiredPlaceholders: ["{{cspList}}"],
    sampleVars: {
      count: "1",
      targetRate: "2",
      cspList:
        "CRITICAL — CRITICAL — inactive 30+ days, urgent daily follow-up by RM and DC\n  • Mohan Lal (1A850112) — 34 days inactive",
    },
    defaultValue:
      "Inactivity digest for you as District Coordinator. {{count}} CSP(s) under you need attention — these have " +
      "reached the point where WhatsApp follow-up alone hasn't been enough.\n\n" +
      "{{cspList}}\n\n" +
      "Target: keep inactivity at or below {{targetRate}}%.\n\n" +
      "-- E.Y.E.S. (EKO Yield & Escalation System)",
  },
  {
    key: "tierHeadlineSelf",
    label: "Tier headline — Self-nudge (3–6 days)",
    description: "Shown at the top of this tier's section inside the email digest body.",
    channel: "email",
    requiredPlaceholders: [],
    sampleVars: {},
    defaultValue: "Inactive — a single transaction today reactivates your terminal",
  },
  {
    key: "tierHeadlineBreach",
    label: "Tier headline — RM follow-up (7–14 days)",
    description: "Shown at the top of this tier's section inside the email digest body.",
    channel: "email",
    requiredPlaceholders: [],
    sampleVars: {},
    defaultValue: "Inactive 7+ days — RM follow-up required",
  },
  {
    key: "tierHeadlineEscalated",
    label: "Tier headline — RM + DC (15–29 days)",
    description: "Shown at the top of this tier's section inside the email digest body.",
    channel: "email",
    requiredPlaceholders: [],
    sampleVars: {},
    defaultValue: "Inactive 15+ days — RM and DC follow-up required",
  },
  {
    key: "tierHeadlineCritical",
    label: "Tier headline — Critical (30+ days)",
    description: "Shown at the top of this tier's section inside the email digest body.",
    channel: "email",
    requiredPlaceholders: [],
    sampleVars: {},
    defaultValue: "CRITICAL — inactive 30+ days, urgent daily follow-up by RM and DC",
  },
];

const DEFS_BY_KEY = new Map(TEMPLATE_DEFS.map((d) => [d.key, d]));

export interface EffectiveTemplate extends TemplateDefinition {
  /** The saved override if one exists, else defaultValue. What rendering actually uses. */
  value: string;
  /** True when an operator has saved a custom value for this key. */
  isCustomized: boolean;
}

function readRaw(key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM templates WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** The effective template text a renderer should use — saved override, else the built-in default. */
export function getTemplate(key: string): string {
  const def = DEFS_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown template key "${key}"`);
  return readRaw(key) ?? def.defaultValue;
}

/** Every template with its current effective value — what the settings UI renders. */
export function getAllTemplates(): EffectiveTemplate[] {
  return TEMPLATE_DEFS.map((def) => {
    const raw = readRaw(def.key);
    return { ...def, value: raw ?? def.defaultValue, isCustomized: raw !== undefined };
  });
}

/** Which required placeholders (if any) are missing from `value`. Empty array = valid. */
export function missingPlaceholders(key: string, value: string): string[] {
  const def = DEFS_BY_KEY.get(key);
  if (!def) return [];
  return def.requiredPlaceholders.filter((token) => !value.includes(token));
}

/**
 * Saves overrides for the given keys. Throws with a message naming the
 * offending key + missing token if any value has dropped a placeholder the
 * renderer depends on — better a rejected save than a message that goes out
 * missing the CSP's name or day count.
 */
export function updateTemplates(patch: Record<string, string>, now: string = new Date().toISOString()): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!DEFS_BY_KEY.has(key)) throw new Error(`Unknown template key "${key}"`);
    const missing = missingPlaceholders(key, value);
    if (missing.length > 0) {
      throw new Error(`Template "${key}" is missing required placeholder(s): ${missing.join(", ")}`);
    }
  }

  const upsert = db.prepare(
    `INSERT INTO templates (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`,
  );
  const write = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) upsert.run(key, value, now, value, now);
  });
  write(Object.entries(patch));
}

/** Resets a template back to its built-in default by deleting the override. */
export function resetTemplate(key: string): void {
  if (!DEFS_BY_KEY.has(key)) throw new Error(`Unknown template key "${key}"`);
  db.prepare(`DELETE FROM templates WHERE key = ?`).run(key);
}

/**
 * `{{token}}` substitution — deliberately simple (no conditionals, no loops).
 * Every template in this registry is a single sentence or line; anything
 * needing structure (the digest body's tier grouping, support/call-required
 * sections) stays in code rather than growing this into a template language.
 */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}
