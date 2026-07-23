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

function daysSince(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
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
