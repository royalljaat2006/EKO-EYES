import { tierForDays } from "../config/escalation";
import { fetchRecords } from "./dataSource.service";
import { isTerminalActive, loadEngagements, recordNudgeSent } from "./cspEngagement.service";
import { renderCspMessage } from "./digest.service";
import { sendDigestWhatsApp } from "./whatsapp/whatsapp.service";
import { getBoolSetting } from "./settings.service";
import logger from "../utils/logger";

export interface OneOffNudgeResult {
  success: boolean;
  cspCode: string;
  personName: string;
  error?: string;
}

/**
 * A deliberate, human-initiated single-CSP nudge — an explicit operator
 * override of the automated cadence/nudge-cap guardrails, triggered from a
 * table row with its own confirm step (never a bare click). Two safety
 * rules are NEVER bypassed even here, because they aren't pacing
 * preferences, they're hard rules: never message a dead terminal (they
 * physically can't respond) and never message someone who explicitly asked
 * to stop. The cooldown and nudge cap ARE bypassed on purpose — a human
 * choosing to send exactly this one message right now is the override case
 * those exist to allow for. Sends WhatsApp only, direct to the CSP
 * themselves (the same copy the automated pipeline would use) — it does
 * not fan out to RM/DC, since the operator is acting on one specific row.
 *
 * The dashboard's global WhatsApp kill switch is a third thing this does
 * NOT override: it is an explicit instruction to stop sending on this
 * channel, so a manual nudge respects it too — otherwise "WhatsApp off"
 * would only mean "off for the automated job", which is not what it says.
 */
export async function sendOneOffNudge(cspCode: string, now: string): Promise<OneOffNudgeResult> {
  if (!getBoolSetting("whatsappEnabled")) {
    return {
      success: false,
      cspCode,
      personName: "",
      error: "WhatsApp notifications are globally disabled in settings.",
    };
  }

  const records = await fetchRecords();
  const record = records.find((r) => r.cspCode === cspCode);
  if (!record) {
    return { success: false, cspCode, personName: "", error: "CSP not found in the current roster." };
  }

  if (record.days === null || tierForDays(record.days) === null) {
    return {
      success: false,
      cspCode,
      personName: record.targetPersonName,
      error: "This CSP is not currently flagged inactive.",
    };
  }
  if (!isTerminalActive(record)) {
    return {
      success: false,
      cspCode,
      personName: record.targetPersonName,
      error: "Terminal is not active — this CSP cannot transact, a nudge would not help.",
    };
  }
  const engagement = loadEngagements().get(cspCode);
  if (engagement?.suppressedReason) {
    return {
      success: false,
      cspCode,
      personName: record.targetPersonName,
      error: "This CSP asked us to stop contacting them — respecting that.",
    };
  }
  if (!record.cspMobile) {
    return {
      success: false,
      cspCode,
      personName: record.targetPersonName,
      error: "No mobile number on file for this CSP.",
    };
  }

  try {
    await sendDigestWhatsApp(record.cspMobile, renderCspMessage(record), {
      name: record.targetPersonName,
      cspCode: record.cspCode,
      days: record.days ?? 0,
    });
    recordNudgeSent(cspCode, now);
    return { success: true, cspCode, personName: record.targetPersonName };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, cspCode }, "One-off nudge failed");
    return { success: false, cspCode, personName: record.targetPersonName, error };
  }
}
