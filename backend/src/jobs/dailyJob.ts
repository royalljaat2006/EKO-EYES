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
  getNudgeCount,
  indexMobiles,
  loadEngagements,
  recordNudgeSent,
  resetEngagement,
} from "../services/cspEngagement.service";
import { runAdaptiveTuning } from "../services/adaptiveTuning.service";
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
import { recordInactivityOnset } from "../services/dailyChangeLog.service";
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
    //    Matched by cspCode (stable), not name — see escalation.service.ts.
    const recovered = detectRecoveries(records, states);
    for (const { cspCode, personName } of recovered) {
      // Read the nudge count BEFORE resetEngagement wipes it — this is the
      // signal the adaptive-tuning loop below learns from.
      const nudgeCountAtRecovery = getNudgeCount(cspCode);
      recordRecovery(cspCode, personName, runAt, nudgeCountAtRecovery);
      // Wipe the nudge count so a future lapse starts from a clean slate rather
      // than resuming at an already-exhausted cap.
      resetEngagement(cspCode);
    }
    if (recovered.length > 0) {
      logger.info(
        { recovered: recovered.map((r) => r.personName) },
        "People recovered since last run",
      );
    }

    // 1b. Re-evaluate the adaptive nudge cap from recovery history so far,
    //     BEFORE deciding today's nudges — see adaptiveTuning.service.ts.
    const tuning = runAdaptiveTuning(runAt);
    logger.info(
      { from: tuning.oldValue, to: tuning.newValue, sampleSize: tuning.sampleSize },
      "Adaptive tuning evaluation complete",
    );

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
        e.record.cspCode,
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
    const newlyInactiveToday = evaluated.filter((e) => e.reason === "entered-tier");
    const newlyInactive = newlyInactiveToday.length;
    // Named audit trail (dailyChangeLog.service.ts) — WHO specifically went
    // active -> inactive today, not just the count. Mirrors recordRecovery
    // above, which already logs the other direction per-person.
    for (const e of newlyInactiveToday) {
      recordInactivityOnset(
        e.record.targetPersonName,
        e.record.cspCode,
        e.policy.tier,
        e.record.days ?? 0,
        runAt,
      );
    }

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
