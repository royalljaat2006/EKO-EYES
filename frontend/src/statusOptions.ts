import type { InactivityRecord } from "./types";

/**
 * The inactivity STATUS bucket for a CSP — distinct from the day-range bucket
 * (rangeOptions.ts). Mirrors the escalation ladder's early stages: a CSP is
 * nudged directly from day 3, "inactive" (alertable) past day 7. Shared by the
 * All CSPs table and the LHO/RM/DC popup so both use the same vocabulary.
 */
export type Status = "inactive" | "at-risk" | "healthy" | "unknown";

export function statusOf(r: Pick<InactivityRecord, "days">): Status {
  if (r.days === null) return "unknown";
  if (r.days > 7) return "inactive";
  if (r.days >= 3) return "at-risk";
  return "healthy";
}

export const STATUS_ORDER: Status[] = ["inactive", "at-risk", "healthy", "unknown"];

export const STATUS_META: Record<
  Status,
  { label: string; className: string; icon: string; color: string }
> = {
  inactive: { label: "Inactive", className: "status--failed", icon: "✕", color: "var(--critical)" },
  "at-risk": { label: "At risk", className: "status--partial", icon: "!", color: "var(--warning)" },
  healthy: { label: "Healthy", className: "status--delivered", icon: "✓", color: "var(--good)" },
  unknown: { label: "No data", className: "status--unknown", icon: "?", color: "var(--muted)" },
};
