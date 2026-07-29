/**
 * Mirrors backend/src/config/escalation.ts's TIERS bounds — same duplication
 * pattern as rangeOptions.ts mirroring inactivityRanges.ts (see SKILLS.md).
 * Only used for the dashboard's tier-strip click-to-reveal; the real
 * escalation policy (who gets nudged, on what channel) lives in the backend.
 */
export type Tier = "self" | "breach" | "escalated" | "critical";

export const TIER_BOUNDS: Record<Tier, [number, number | null]> = {
  self: [3, 6],
  breach: [7, 14],
  escalated: [15, 29],
  critical: [30, null],
};

export function tierForDays(days: number | null): Tier | null {
  if (days === null) return null;
  for (const tier of Object.keys(TIER_BOUNDS) as Tier[]) {
    const [min, max] = TIER_BOUNDS[tier];
    if (days >= min && (max === null || days <= max)) return tier;
  }
  return null;
}
