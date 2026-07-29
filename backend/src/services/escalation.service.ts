import env from "../config/env";
import { Tier, TierPolicy, isEscalation, tierForDays } from "../config/escalation";
import { InactivityRecord } from "../types";
import { PersonState } from "./stateStore.service";

export interface EvaluatedPerson {
  record: InactivityRecord;
  policy: TierPolicy;
  previousTier: Tier | null;
  /** Should we actually send today? */
  shouldNotify: boolean;
  reason: "entered-tier" | "escalated" | "cadence-due" | "suppressed-recent";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for `date` in the business's configured timezone (env.TIMEZONE) — not raw UTC, not the server's local zone. */
function calendarDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function toUtcMidnight(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole CALENDAR DAYS elapsed since `iso`, in the configured timezone —
 * deliberately NOT a raw millisecond-based day count.
 *
 * The daily job fires at a fixed wall-clock time each day, but the exact
 * moment it reaches `now = new Date()` still varies run to run by a few
 * hundred milliseconds (system load, event loop timing). A millisecond
 * floor comparison is fragile to exactly that jitter: two runs "a day
 * apart" are almost never EXACTLY 24h*N apart, so `floor(msDiff / DAY_MS)`
 * can land on 0.999996 days and round DOWN to 0 — silently skipping a
 * day's resend, unpredictably, depending on whether today's run happened
 * to start a few hundred ms earlier than yesterday's. This bit a real
 * critical-tier CSP: last_notified_at and the next run were 86,399,684ms
 * apart — 316ms short of 24h — so a resend due "today" was suppressed.
 *
 * Comparing calendar dates instead means "yesterday to today" is always
 * exactly 1, regardless of what time within each day the job ran.
 */
function daysSince(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const lastKey = calendarDateKey(new Date(iso));
  const nowKey = calendarDateKey(now);
  if (lastKey === nowKey) return 0;
  return Math.round((toUtcMidnight(nowKey) - toUtcMidnight(lastKey)) / DAY_MS);
}

/**
 * Decides who gets messaged today.
 *
 * The old behaviour re-sent an identical alert every single day, which is the
 * fastest way to train people to ignore it. Here a person is notified when they
 * ENTER a tier or ESCALATE to a higher one, and otherwise only once their
 * tier's re-send cadence comes due. Severity is the only thing that buys
 * frequency.
 */
export function evaluatePerson(
  record: InactivityRecord,
  state: PersonState | undefined,
  now: Date = new Date(),
): EvaluatedPerson | null {
  // Unknown inactivity ("No transaction data") is never alerted on — we would be
  // guessing. These rows are surfaced on the dashboard for a human to resolve.
  if (record.days === null) return null;

  const policy = tierForDays(record.days);
  if (!policy) return null; // below the early-warning floor: healthy, say nothing

  const previousTier = state?.tier ?? null;
  const sinceLastNotified = daysSince(state?.lastNotifiedAt ?? null, now);

  if (previousTier === null) {
    return { record, policy, previousTier, shouldNotify: true, reason: "entered-tier" };
  }
  if (isEscalation(previousTier, policy.tier)) {
    return { record, policy, previousTier, shouldNotify: true, reason: "escalated" };
  }
  if (sinceLastNotified >= policy.resendEveryDays) {
    return { record, policy, previousTier, shouldNotify: true, reason: "cadence-due" };
  }
  return { record, policy, previousTier, shouldNotify: false, reason: "suppressed-recent" };
}

export function evaluateAll(
  records: InactivityRecord[],
  states: Map<string, PersonState>,
  now: Date = new Date(),
): EvaluatedPerson[] {
  return records
    .map((r) => evaluatePerson(r, states.get(r.cspCode), now))
    .filter((e): e is EvaluatedPerson => e !== null);
}

export interface RecoveredPerson {
  cspCode: string;
  personName: string;
}

/**
 * A recovery = someone who was previously in a tier but is now below the
 * early-warning floor (or gone from the sheet entirely). This is the metric
 * that tells us whether any of the alerting actually works.
 *
 * Keyed by cspCode (stable), not name — a name edit in the source sheet must
 * never look like a recovery. See stateStore.service.ts's migration note.
 */
export function detectRecoveries(
  records: InactivityRecord[],
  states: Map<string, PersonState>,
): RecoveredPerson[] {
  const currentlyFlagged = new Set(
    records
      .filter((r) => r.days !== null && tierForDays(r.days) !== null)
      .map((r) => r.cspCode),
  );
  const recovered: RecoveredPerson[] = [];
  for (const [cspCode, state] of states) {
    if (state.tier !== null && !currentlyFlagged.has(cspCode)) {
      recovered.push({ cspCode, personName: state.personName });
    }
  }
  return recovered;
}
