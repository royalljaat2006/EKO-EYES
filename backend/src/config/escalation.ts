import { NotificationChannel, NotificationRole } from "../types";

export type Tier = "self" | "breach" | "escalated" | "critical";

export interface TierPolicy {
  tier: Tier;
  /** Inclusive lower bound of the Days value for this tier. */
  minDays: number;
  /** Inclusive upper bound; null = open ended. */
  maxDays: number | null;
  label: string;
  roles: NotificationRole[];
  /**
   * Which channels EACH role gets, for this tier — not one shared list
   * anymore. RM and DC now diverge: RM gets email as soon as they're in
   * scope, DC starts WhatsApp-only and only earns email once the CSP reaches
   * the critical tier. A role absent from this map (or CSP, which is
   * special-cased in digest.service.ts) falls back to no channels, so every
   * role actually messaged must have an explicit entry here.
   */
  channelsByRole: Partial<Record<NotificationRole, NotificationChannel[]>>;
  /**
   * Re-send cadence in days while a person stays in this tier. A person is
   * always notified on ENTERING a tier; after that they are only re-notified
   * once this many days have elapsed. This is the anti-fatigue mechanism —
   * severity buys frequency, nothing else does.
   */
  resendEveryDays: number;
}

/**
 * The ladder. Design rules:
 *
 *  1. Go to the person who can actually fix it FIRST. Days 3–6 the CSP is
 *     nudged directly and NOBODY ELSE is told — they get a chance to fix it
 *     themselves before it is escalated.
 *  2. Each role's CHANNEL widens as severity increases, not just the
 *     headcount: RM joins at day 7 on both WhatsApp and email immediately —
 *     RM never gets a WhatsApp-only period. DC joins later (day 15) and
 *     starts WhatsApp-only, only escalating to email once the CSP reaches
 *     the critical tier (day 30+). So DC's involvement itself has two
 *     stages: a quieter WhatsApp-only nudge, then the full email digest.
 *  3. Only three parties are ever involved: CSP, RM, DC. No manager, no
 *     leadership.
 *
 * The CSP stays on every tier — they are the one who has to act.
 *
 * Frequency note: the daily job runs once a day, so "every 1 day" is the
 * maximum cadence. CSP messaging is additionally bounded by the nudge cap /
 * cooldown in cspEngagement.service so raising frequency here cannot become
 * harassment.
 *
 * NOTE: the Calling Sheet has no CSP email, only a mobile, so CSPs are
 * reached on WhatsApp only — enforced separately in digest.service.ts's
 * channelsFor(), not here, since it's a data-availability fact, not a policy
 * choice.
 *
 * The actual wording sent (WhatsApp nudge text, email subject, tier
 * headlines shown inside the email digest body) lives in
 * templates.service.ts, editable from the dashboard's Templates panel — this
 * file only decides WHO is contacted, on WHICH channel, and HOW OFTEN.
 */
export const TIERS: TierPolicy[] = [
  {
    tier: "self",
    minDays: 3,
    maxDays: 6,
    label: "Self-nudge",
    // The CSP and nobody else — a private nudge, not a report.
    roles: ["CSP"],
    channelsByRole: { CSP: ["whatsapp"] },
    resendEveryDays: 1,
  },
  {
    tier: "breach",
    minDays: 7,
    maxDays: 14,
    label: "RM follow-up",
    roles: ["CSP", "RM"],
    channelsByRole: {
      CSP: ["whatsapp"],
      RM: ["whatsapp", "email"],
    },
    resendEveryDays: 1,
  },
  {
    tier: "escalated",
    minDays: 15,
    maxDays: 29,
    label: "RM + DC",
    roles: ["CSP", "RM", "DC"],
    channelsByRole: {
      CSP: ["whatsapp"],
      RM: ["whatsapp", "email"],
      // DC's first stage: WhatsApp only, until critical.
      DC: ["whatsapp"],
    },
    resendEveryDays: 1,
  },
  {
    tier: "critical",
    minDays: 30,
    maxDays: null,
    label: "Critical",
    roles: ["CSP", "RM", "DC"],
    channelsByRole: {
      CSP: ["whatsapp"],
      RM: ["whatsapp", "email"],
      // DC's second stage: now also gets the email digest.
      DC: ["whatsapp", "email"],
    },
    resendEveryDays: 1,
  },
];

export function tierForDays(days: number): TierPolicy | null {
  return (
    TIERS.find((t) => days >= t.minDays && (t.maxDays === null || days <= t.maxDays)) ?? null
  );
}

export function tierRank(tier: Tier): number {
  return TIERS.findIndex((t) => t.tier === tier);
}

/** True when moving from `from` to `to` is a step UP the ladder. */
export function isEscalation(from: Tier | null, to: Tier): boolean {
  if (from === null) return true;
  return tierRank(to) > tierRank(from);
}
