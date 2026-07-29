import logger from "../utils/logger";
import { getNumberSetting } from "../services/settings.service";
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
import { evaluateAll } from "../services/escalation.service";
import {
  diffRoster,
  saveDailySnapshot,
  snapshotDayCount,
} from "../services/dailySnapshot.service";
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

    // 1. THE day-over-day comparison. Diffed against yesterday's IMMUTABLE
    //    snapshot (dailySnapshot.service.ts), never against live
    //    `person_state` — that used to be rewritten every minute by the sheet
    //    refresh, so the baseline was already today's data by the time we got
    //    here and nothing ever looked changed. `person_state` is still read
    //    below, but only for notification cadence (when did we last message
    //    this person), which is a different question.
    //
    //    The diff separates a real transition (healthy yesterday -> flagged
    //    today) from a CSP that merely APPEARED in the sheet already flagged.
    //    The second is a roster event, not a behaviour change, so it never
    //    inflates the "newly inactive" count.
    const diff = diffRoster(records, today);
    if (diff.comparedTo === null) {
      logger.warn(
        { snapshotDays: snapshotDayCount() },
        "No earlier roster snapshot to compare against — recording today as the baseline and reporting zero changes. " +
          "Day-over-day numbers become real from the next run.",
      );
    } else {
      logger.info(
        {
          comparedTo: diff.comparedTo,
          newlyInactive: diff.newlyInactive.length,
          newCspsAdded: diff.newCspsAdded.length,
          recovered: diff.recovered.length,
          droppedWhileFlagged: diff.droppedWhileFlagged.length,
        },
        "Day-over-day roster diff complete",
      );
    }

    for (const { record, previousTier, previousDays } of diff.recovered) {
      // Read the nudge count BEFORE resetEngagement wipes it — this is the
      // signal the adaptive-tuning loop below learns from.
      const nudgeCountAtRecovery = getNudgeCount(record.cspCode);
      // Attribute the recovery to whoever is assigned to them right now, for
      // the RM/DC performance stats.
      recordRecovery(
        record.cspCode,
        record.targetPersonName,
        runAt,
        nudgeCountAtRecovery,
        record.rmName || null,
        record.dcName || null,
      );
      // Wipe the nudge count so a future lapse starts from a clean slate rather
      // than resuming at an already-exhausted cap.
      resetEngagement(record.cspCode);
      logger.debug(
        { cspCode: record.cspCode, from: previousTier, wasDays: previousDays, nowDays: record.days },
        "Recovered since yesterday",
      );
    }

    if (diff.droppedWhileFlagged.length > 0) {
      // NOT logged as recoveries: we cannot tell a genuine recovery from a row
      // being deleted or reassigned in the sheet, and crediting the alerting
      // for a deletion would quietly inflate the recovery rate.
      logger.warn(
        { count: diff.droppedWhileFlagged.length, csps: diff.droppedWhileFlagged.map((e) => e.cspCode) },
        "CSPs were flagged yesterday but have vanished from the sheet — NOT counted as recoveries",
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
    const digests = buildDigests(dueToday, decisions, records);
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

    // 4. Persist notification state — who is in which tier, and whether we
    //    messaged them today. This drives the anti-nagging cadence
    //    (`resendEveryDays`), NOT the day-over-day comparison, which now reads
    //    the snapshot written in step 6 instead.
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

    // 5. Record WHO changed today, from the snapshot diff — the named audit
    //    trail behind the dashboard's daily-change numbers. Real transitions
    //    and roster additions are written to the same table but flagged
    //    apart, so the count only ever reflects actual behaviour change.
    for (const { record, tier, previousDays } of diff.newlyInactive) {
      recordInactivityOnset(
        record.targetPersonName,
        record.cspCode,
        tier,
        record.days ?? 0,
        runAt,
        false,
        previousDays,
      );
    }
    for (const { record, tier } of diff.newCspsAdded) {
      recordInactivityOnset(
        record.targetPersonName,
        record.cspCode,
        tier,
        record.days ?? 0,
        runAt,
        true,
        null,
      );
    }

    // 6. Snapshot the number we are actually trying to move. The rate is measured
    //    only over rows we can measure; "No transaction data" is not a zero.
    const measurable = known(records);
    const inactiveCount = measurable.filter(
      (r) => r.days > getNumberSetting("inactivityThresholdDays"),
    ).length;
    const atRiskCount = measurable.filter((r) => tierForDays(r.days)?.tier === "self").length;
    // Both counts come from the SAME diff, so they can never disagree with the
    // per-person audit trail above. A "breach" is a transition that landed
    // past the CSP-only self-nudge stage; `newlyInactive` is every real
    // transition at any severity. Roster additions are in neither — they did
    // not transition.
    const newBreaches = diff.newlyInactive.filter((n) => n.tier !== "self").length;
    const newlyInactive = diff.newlyInactive.length;

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
      recoveries: diff.recovered.length,
      newlyInactive,
      rangeCounts,
    });

    // 7. Freeze today's roster LAST — after every comparison is done — so it
    //    becomes tomorrow's baseline. Written once per day by this job only.
    saveDailySnapshot(today, records);

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
        target: getNumberSetting("targetInactivityRate"),
        comparedTo: diff.comparedTo,
        newlyInactive,
        newCspsAdded: diff.newCspsAdded.length,
        recovered: diff.recovered.length,
      },
      "Daily inactivity job complete",
    );

    return result;
  } finally {
    isRunning = false;
  }
}
