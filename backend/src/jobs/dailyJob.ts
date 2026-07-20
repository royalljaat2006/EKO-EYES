import env from "../config/env";
import logger from "../utils/logger";
import { fetchRecords, invalidateCache } from "../services/dataSource.service";
import { persistDailyJobResult } from "../services/alertStore.service";
import {
  buildDigests,
  findUnreachable,
  needsCall,
  needsSupport,
  sendDigests,
  NudgeDecisions,
} from "../services/digest.service";
import {
  decideNudge,
  indexMobiles,
  loadEngagements,
  recordNudgeSent,
  resetEngagement,
} from "../services/cspEngagement.service";
import { known, unknownCount } from "../services/inactivity.service";
import { invalidateContactsCache } from "../services/contacts.service";
import { detectRecoveries, evaluateAll } from "../services/escalation.service";
import { computeRate } from "../services/kpi.service";
import {
  loadPersonStates,
  recordRecovery,
  saveKpiSnapshot,
  upsertPersonState,
} from "../services/stateStore.service";
import { tierForDays } from "../config/escalation";
import { RANGE_OPTIONS, RangeOption, inRange } from "../config/inactivityRanges";
import { DailyJobResult } from "../types";

let isRunning = false;

/**
 * The daily pipeline:
 *   ingest -> detect recoveries -> tier everyone -> decide who to notify today
 *   -> send ONE digest per recipient -> persist state -> snapshot the KPI
 *
 * The two behavioural changes that matter: people are caught at day 5 (before
 * they breach), and nobody receives the same alert two days running unless
 * their tier's cadence says so.
 */
export async function runDailyInactivityJob(): Promise<DailyJobResult> {
  if (isRunning) {
    logger.warn("Daily inactivity job already running, skipping this trigger");
    return {
      runAt: new Date().toISOString(),
      totalRecordsIngested: 0,
      totalAlertsMatched: 0,
      notifications: [],
    };
  }

  isRunning = true;
  const now = new Date();
  const runAt = now.toISOString();
  const today = runAt.slice(0, 10);
  logger.info({ runAt }, "Starting daily inactivity job");

  try {
    invalidateCache();
    invalidateContactsCache();
    const records = await fetchRecords(true);
    const states = loadPersonStates();

    // 1. Anyone who dropped out of a tier since the last run has recovered.
    const recovered = detectRecoveries(records, states);
    const codeByName = new Map(records.map((r) => [r.targetPersonName, r.cspCode]));
    for (const name of recovered) {
      recordRecovery(name, runAt);
      // Wipe the nudge count so a future lapse starts from a clean slate rather
      // than resuming at an already-exhausted cap.
      const code = codeByName.get(name);
      if (code) resetEngagement(code);
    }
    if (recovered.length > 0) {
      logger.info({ recovered }, "People recovered since last run");
    }

    // 2. Tier everyone and decide who is actually due a message today.
    const evaluated = evaluateAll(records, states, now);
    const dueToday = evaluated.filter((e) => e.shouldNotify);
    const suppressed = evaluated.length - dueToday.length;

    logger.info(
      {
        flagged: evaluated.length,
        notifying: dueToday.length,
        suppressedByCadence: suppressed,
      },
      "Evaluated escalation tiers",
    );

    // 3. Apply the CSP guardrails BEFORE anything is sent. This is what stops the
    //    agent nagging someone whose terminal is dead, or texting a person who has
    //    already ignored three messages.
    indexMobiles(records);
    const engagements = loadEngagements();
    const decisions: NudgeDecisions = new Map();
    for (const e of dueToday) {
      if (e.policy.roles.includes("CSP")) {
        decisions.set(
          e.record.cspCode,
          decideNudge(e.record, engagements.get(e.record.cspCode), now),
        );
      }
    }

    const supportCases = needsSupport(decisions, dueToday);
    const callCases = needsCall(decisions, dueToday);

    logger.info(
      {
        cspNudges: [...decisions.values()].filter((d) => d === "send").length,
        skippedDeadTerminal: supportCases.length,
        skippedCapOrNoMobile: callCases.length,
        skippedCooldownOrReply: [...decisions.values()].filter(
          (d) => d === "cooldown" || d === "suppressed-by-reply",
        ).length,
      },
      "Applied CSP contact guardrails",
    );

    // 4. One digest per recipient, not one message per person. Anyone whose RM/DC
    //    has no contact on file is recorded as an explicit failure, not dropped.
    const digests = buildDigests(dueToday, decisions);
    const unreachable = findUnreachable(dueToday);
    const notifications = [...(await sendDigests(digests, decisions)), ...unreachable];

    // Count the nudges we actually sent, so the cap is real.
    for (const [cspCode, decision] of decisions) {
      if (decision === "send") recordNudgeSent(cspCode, runAt);
    }

    if (unreachable.length > 0) {
      logger.warn(
        { count: unreachable.length },
        "Alerts could NOT be sent — missing RM/DC contact details",
      );
    }
    if (supportCases.length > 0) {
      logger.warn(
        { count: supportCases.length },
        "CSPs with an INACTIVE TERMINAL were not nudged — routed to support instead",
      );
    }

    // 4. Persist state so tomorrow's run can dedupe and detect recovery.
    for (const e of evaluated) {
      // evaluatePerson() only returns rows with a known days value, so this is safe.
      upsertPersonState(
        e.record.targetPersonName,
        e.policy.tier,
        e.record.days ?? 0,
        e.shouldNotify,
        runAt,
      );
    }

    // 5. Snapshot the number we are actually trying to move. The rate is measured
    //    only over rows we can measure; "No transaction data" is not a zero.
    const measurable = known(records);
    const inactiveCount = measurable.filter(
      (r) => r.days > env.INACTIVITY_THRESHOLD_DAYS,
    ).length;
    const atRiskCount = measurable.filter((r) => tierForDays(r.days)?.tier === "self").length;
    // A "breach" is escalating past the CSP-only self-nudge stage.
    const newBreaches = evaluated.filter(
      (e) => e.reason === "entered-tier" && e.policy.tier !== "self",
    ).length;
    // The daily-change chart's other half: EVERY first-time entrant, including
    // day-3 self-nudge — i.e. someone who was active yesterday and is flagged
    // today, at any severity. Distinct from newBreaches above.
    const newlyInactive = evaluated.filter((e) => e.reason === "entered-tier").length;

    const rangeCounts: Record<RangeOption, number> = {} as Record<RangeOption, number>;
    for (const opt of RANGE_OPTIONS) {
      rangeCounts[opt] = measurable.filter((r) => inRange(r.days, opt)).length;
    }

    saveKpiSnapshot({
      day: today,
      totalPeople: measurable.length,
      inactiveCount,
      inactivityRate: computeRate(inactiveCount, measurable.length),
      atRiskCount,
      newBreaches,
      recoveries: recovered.length,
      newlyInactive,
      rangeCounts,
    });

    const result: DailyJobResult = {
      runAt,
      totalRecordsIngested: records.length,
      totalAlertsMatched: dueToday.length,
      notifications,
    };

    const jobRunId = persistDailyJobResult(result);
    const failures = notifications.filter((n) => !n.success).length;
    logger.info(
      {
        jobRunId,
        digests: digests.length,
        sent: notifications.length - failures,
        failed: failures,
        unreachable: unreachable.length,
        unknownDays: unknownCount(records),
        inactivityRate: computeRate(inactiveCount, measurable.length),
        target: env.TARGET_INACTIVITY_RATE,
      },
      "Daily inactivity job complete",
    );

    return result;
  } finally {
    isRunning = false;
  }
}
