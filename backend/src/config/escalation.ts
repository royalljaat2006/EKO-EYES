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
  channels: NotificationChannel[];
  /**
   * Re-send cadence in days while a person stays in this tier. A person is
   * always notified on ENTERING a tier; after that they are only re-notified
   * once this many days have elapsed. This is the anti-fatigue mechanism —
   * severity buys frequency, nothing else does.
   */
  resendEveryDays: number;
  /** Escalation copy shown at the top of the digest section. */
  headline: string;
}

/**
 * The ladder. Design rules:
 *
 *  1. Go to the person who can actually fix it FIRST. Past 3 days inactive the
 *     CSP is nudged directly and NOBODY ELSE is told — they get a chance to fix
 *     it themselves before it is escalated.
 *  2. The original contract is preserved: anyone with Days > 7 gets an email AND
 *     a WhatsApp message to BOTH the RM and the DC.
 *  3. Only three parties are ever involved: CSP, RM, DC. No manager, no
 *     leadership. Escalation past day 7 raises FREQUENCY and urgency, not the
 *     number of people looped in.
 *
 * The CSP stays on every tier — they are the one who has to act.
 *
 * Frequency note: the daily job runs once a day, so "every 1 day" is the maximum
 * cadence. CSP messaging is additionally bounded by the nudge cap / cooldown in
 * cspEngagement.service so raising frequency here cannot become harassment.
 *
 * NOTE: the Calling Sheet has no CSP email, only a mobile, so CSPs are reached
 * on WhatsApp only. A blank/corrupt mobile makes them unreachable (reported).
 */
export const TIERS: TierPolicy[] = [
  {
    tier: "self",
    minDays: 3,
    maxDays: 7,
    label: "Self-nudge",
    // The CSP and nobody else — a private nudge, not a report.
    roles: ["CSP"],
    channels: ["whatsapp"],
    resendEveryDays: 1,
    headline: "Inactive — a single transaction today reactivates your terminal",
  },
  {
    tier: "breach",
    minDays: 8, // "more than 7 days"
    maxDays: 15,
    label: "RM follow-up",
    roles: ["CSP", "RM"],
    channels: ["email", "whatsapp"],
    resendEveryDays: 1,
    headline: "Inactive over 7 days — RM follow-up required",
  },
  {
    tier: "escalated",
    minDays: 16, // "more than 15 days"
    maxDays: 23,
    label: "RM + DC",
    roles: ["CSP", "RM", "DC"],
    channels: ["email", "whatsapp"],
    resendEveryDays: 1,
    headline: "Inactive over 15 days — RM and DC follow-up required",
  },
  {
    tier: "critical",
    minDays: 24, // "more than 23 days"
    maxDays: null,
    label: "Critical",
    roles: ["CSP", "RM", "DC"],
    channels: ["email", "whatsapp"],
    resendEveryDays: 1,
    headline: "CRITICAL — inactive 23+ days, urgent daily follow-up by RM and DC",
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
