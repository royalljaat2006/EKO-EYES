import { tierForDays } from "../config/escalation";
import { InactivityRecord } from "../types";
import { decideNudge, loadEngagements } from "./cspEngagement.service";
import { getOnsetCounts } from "./dailyChangeLog.service";
import { GeoBreakdown } from "./analytics.service";

/**
 * Rule-based "ops assistant" layer — deliberately NOT an LLM call. Every
 * number and sentence here is template text or a disclosed if/else rule
 * over data already computed elsewhere (recovery_log, inactivity_onset_log,
 * the roster, decideNudge's own guardrail decision). Built this way on
 * purpose: an AI daily-summary/recommendation/risk-prediction layer was
 * explicitly scoped OUT (deferred, "we will figure out something"), but the
 * underlying INFORMATION needs — a plain-English daily readout, "who needs
 * escalation," "who's trending toward inactive" — don't require an LLM to
 * answer honestly. See SKILLS.md.
 */

export interface DailySummary {
  text: string;
  stats: {
    totalInactive: number;
    newlyInactiveToday: number;
    crossed3: number;
    crossed7: number;
    crossed30: number;
    nonResponsive: number;
    worstDistrict: { label: string; rate: number } | null;
  };
}

/**
 * A plain-English readout of today's numbers — every figure is real and
 * traceable to a specific query, assembled with a template, not generated.
 */
export function getDailySummary(
  records: InactivityRecord[],
  geo: GeoBreakdown,
  nonResponsive: number,
  newlyInactiveToday: number,
): DailySummary {
  const crossed3 = records.filter((r) => r.days !== null && r.days >= 3 && r.days < 90).length;
  const crossed7 = records.filter((r) => r.days !== null && r.days >= 7 && r.days < 90).length;
  const crossed30 = records.filter((r) => r.days !== null && r.days >= 30 && r.days < 90).length;
  const worstDistrict = geo.districts.length > 0 ? geo.districts[0] : null;

  const parts = [
    `Today there are ${crossed3} inactive CSPs (3+ days).`,
    newlyInactiveToday > 0
      ? `${newlyInactiveToday} newly crossed into inactivity today.`
      : `No one newly crossed into inactivity today.`,
    `Of those, ${crossed7} have gone 7+ days and ${crossed30} have gone 30+ days.`,
    `${nonResponsive} ${nonResponsive === 1 ? "is" : "are"} currently Non Responsive.`,
    worstDistrict
      ? `${worstDistrict.label} has the highest inactivity rate today, at ${worstDistrict.rate}%.`
      : "",
  ].filter(Boolean);

  return {
    text: parts.join(" "),
    stats: { totalInactive: crossed3, newlyInactiveToday, crossed3, crossed7, crossed30, nonResponsive, worstDistrict },
  };
}

export type RecommendationCategory = "visit" | "call";

export interface Recommendation {
  cspCode: string;
  personName: string;
  days: number | null;
  rmName: string;
  category: RecommendationCategory;
  reason: string;
}

/**
 * Rule-based next-action suggestion per currently-inactive CSP:
 *  - Nudge cap exhausted / explicitly asked to stop -> recommend a visit
 *    (decideNudge's own decision, not a new rule).
 *  - Crossed into a tier 2+ times in the last 90 days -> recommend a visit
 *    (a call/WhatsApp clearly hasn't stuck).
 *  - Otherwise -> keep calling/messaging, no escalation needed yet.
 * Every reason string names the exact number that produced it.
 */
export function getRecommendations(records: InactivityRecord[]): Recommendation[] {
  const engagements = loadEngagements();
  const onsetCounts = getOnsetCounts(90);

  const out: Recommendation[] = [];
  for (const r of records) {
    if (r.days === null || tierForDays(r.days) === null) continue;
    const decision = decideNudge(r, engagements.get(r.cspCode));
    const priorOnsets = onsetCounts.get(r.cspCode) ?? 0;

    if (decision === "nudge-cap-reached" || decision === "suppressed-by-reply") {
      out.push({
        cspCode: r.cspCode,
        personName: r.targetPersonName,
        days: r.days,
        rmName: r.rmName,
        category: "visit",
        reason:
          decision === "nudge-cap-reached"
            ? "Nudge cap reached with no recovery — recommend an in-person RM visit instead of another message."
            : "Asked to stop / no further contact — recommend an in-person RM visit to resolve in person.",
      });
    } else if (priorOnsets >= 2) {
      out.push({
        cspCode: r.cspCode,
        personName: r.targetPersonName,
        days: r.days,
        rmName: r.rmName,
        category: "visit",
        reason: `Crossed into inactivity ${priorOnsets} times in the last 90 days — a call alone hasn't stuck; recommend an RM visit.`,
      });
    } else {
      out.push({
        cspCode: r.cspCode,
        personName: r.targetPersonName,
        days: r.days,
        rmName: r.rmName,
        category: "call",
        reason: "First occurrence, still within the nudge cycle — WhatsApp/call should be enough for now.",
      });
    }
  }

  return out.sort((a, b) => (a.category === b.category ? (b.days ?? 0) - (a.days ?? 0) : a.category === "visit" ? -1 : 1));
}

export interface AtRiskEntry {
  cspCode: string;
  personName: string;
  days: number | null;
  rmName: string;
  reason: string;
}

/**
 * Early warning, NOT machine-learned prediction — two disclosed rules over
 * currently-healthy (0-2 day) CSPs:
 *  - 1-2 days from the 3-day self-nudge threshold.
 *  - A relapse history (crossed into inactivity before in the last 90 days),
 *    even though currently healthy.
 * A CSP can match either, both, or neither; only listed if at least one
 * fires. This is a transparent if/else, not a statistical model — labelled
 * as such in the UI too.
 */
export function getAtRiskCsps(records: InactivityRecord[]): AtRiskEntry[] {
  const onsetCounts = getOnsetCounts(90);
  const out: AtRiskEntry[] = [];

  for (const r of records) {
    if (r.days === null || r.days >= 3) continue;
    const priorOnsets = onsetCounts.get(r.cspCode) ?? 0;
    const reasons: string[] = [];

    if (r.days === 2) reasons.push("1 day from the 3-day self-nudge threshold");
    else if (r.days === 1) reasons.push("2 days from the 3-day self-nudge threshold");

    if (priorOnsets >= 1) {
      reasons.push(`flagged inactive ${priorOnsets} time${priorOnsets === 1 ? "" : "s"} in the last 90 days`);
    }

    if (reasons.length === 0) continue;
    out.push({
      cspCode: r.cspCode,
      personName: r.targetPersonName,
      days: r.days,
      rmName: r.rmName,
      reason: reasons.join(" · "),
    });
  }

  return out.sort((a, b) => (a.days ?? 99) - (b.days ?? 99));
}
