import { Router } from "express";
import { z } from "zod";
import { getInactivityDashboardData } from "../services/inactivity.service";
import { RANGE_FILTER_OPTIONS } from "../config/inactivityRanges";
import {
  getRecentJobRuns,
  getAlertsForRun,
  getDeliverySummary,
  updateAlertDeliveryStatus,
} from "../services/alertStore.service";
import { runDailyInactivityJob } from "../jobs/dailyJob";
import { countNonResponsive, getKpiReport, listNonResponsive } from "../services/kpi.service";
import { fetchRecords } from "../services/dataSource.service";
import { runTestDelivery } from "../services/testDelivery.service";
import { getDailyChanges } from "../services/dailyChangeLog.service";
import { getTuningReport, resetTunedMaxNudges } from "../services/adaptiveTuning.service";
import { getSettings, updateSettings } from "../services/settings.service";
import {
  getAllTemplates,
  resetTemplate,
  updateTemplates,
} from "../services/templates.service";
import { getMessageReach } from "../services/messageReach.service";
import { getEmailDrafts } from "../services/emailDrafts.service";
import { getGeoBreakdown, getRmDcPerformance } from "../services/analytics.service";
import { getAtRiskCsps, getDailySummary, getRecommendations } from "../services/insights.service";
import { sendOneOffNudge } from "../services/oneOffNudge.service";
import logger from "../utils/logger";

const router = Router();

/** A bare 10-digit number is assumed Indian; anything else is passed through with a leading +. */
function normalizeMobile(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

const querySchema = z.object({
  range: z.enum(RANGE_FILTER_OPTIONS),
});

/** GET /api/inactivity?range=all|3-7|7-15|15-30|30-60|60-90|90+ */
router.get("/inactivity", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    const data = await getInactivityDashboardData(parsed.data.range);
    return res.json(data);
  } catch (err) {
    logger.error({ err }, "Failed to load inactivity dashboard data");
    return res.status(502).json({ error: "Failed to fetch data from Google Sheets" });
  }
});

/**
 * GET /api/csps - the FULL roster: every CSP in the sheet, including healthy
 * ones (0 days) and unmeasurable ones ("No transaction data"). The threshold
 * filter deliberately does not apply here.
 */
router.get("/csps", async (_req, res) => {
  try {
    const records = await fetchRecords();
    // Worst first, with unmeasurable rows last (they sort as -1).
    const sorted = [...records].sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
    return res.json({
      generatedAt: new Date().toISOString(),
      total: sorted.length,
      records: sorted,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load full CSP roster");
    return res.status(502).json({ error: "Failed to load CSP data" });
  }
});

const kpiQuerySchema = z.object({
  range: z.enum(RANGE_FILTER_OPTIONS).optional(),
});

/**
 * GET /api/kpi[?range=all|3-7|7-15|15-30|30-60|60-90|90+]
 * Inactivity rate vs target, trend, recoveries, tier breakdown. When `range`
 * is given, also returns `rangeTrend` — that bucket's CSP count per day, for
 * the dashboard's filter-linked chart.
 */
router.get("/kpi", async (req, res) => {
  const parsed = kpiQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }
  try {
    return res.json(await getKpiReport(parsed.data.range));
  } catch (err) {
    logger.error({ err }, "Failed to build KPI report");
    return res.status(502).json({ error: "Failed to fetch data from Google Sheets" });
  }
});

/**
 * GET /api/non-responsive
 * The named list behind the "Non Responsive" KPI count — currently-inactive
 * CSPs decideNudge would refuse to message again (nudge cap exhausted, or
 * they asked us to stop). Same guardrail decision the daily job uses, not a
 * separate rule.
 */
router.get("/non-responsive", async (_req, res) => {
  try {
    const records = await fetchRecords();
    return res.json({ records: listNonResponsive(records) });
  } catch (err) {
    logger.error({ err }, "Failed to load non-responsive list");
    return res.status(502).json({ error: "Failed to fetch data from Google Sheets" });
  }
});

/**
 * GET /api/geo-breakdown
 * State- and district-wise inactivity breakdown for the heat map — ranked by
 * inactivity rate, deduped case-insensitively (the sheet has the same place
 * spelled with different casing in different rows).
 */
router.get("/geo-breakdown", async (_req, res) => {
  try {
    const records = await fetchRecords();
    return res.json(getGeoBreakdown(records));
  } catch (err) {
    logger.error({ err }, "Failed to build geo breakdown");
    return res.status(502).json({ error: "Failed to fetch data from Google Sheets" });
  }
});

/**
 * GET /api/rm-dc-performance
 * Per-RM and per-DC recovery performance: how many CSPs are currently
 * inactive under them, how many they've recovered in the trailing 30 days,
 * average days-to-recovery, and an efficiency % (recovered / (recovered +
 * currently inactive)) — the same recipe as the global recoveryRate, scoped
 * per person. Pure arithmetic over recovery_log + the roster, no AI.
 */
router.get("/rm-dc-performance", async (_req, res) => {
  try {
    const records = await fetchRecords();
    return res.json(getRmDcPerformance(records));
  } catch (err) {
    logger.error({ err }, "Failed to build RM/DC performance report");
    return res.status(502).json({ error: "Failed to fetch data from Google Sheets" });
  }
});

/**
 * GET /api/insights/summary
 * A plain-English daily readout, assembled by template from real numbers —
 * NOT an LLM call. See insights.service.ts / SKILLS.md.
 */
router.get("/insights/summary", async (_req, res) => {
  try {
    const records = await fetchRecords();
    const [geo, changes] = [getGeoBreakdown(records), getDailyChanges()];
    const nonResponsive = countNonResponsive(records);
    return res.json(getDailySummary(records, geo, nonResponsive, changes.newlyInactive.length));
  } catch (err) {
    logger.error({ err }, "Failed to build daily summary");
    return res.status(502).json({ error: "Failed to fetch data from Google Sheets" });
  }
});

/**
 * GET /api/insights/recommendations
 * Rule-based next-action suggestion per currently-inactive CSP (visit vs.
 * keep calling) — reuses decideNudge's own decision plus a disclosed
 * repeat-offender count. Not an LLM call.
 */
router.get("/insights/recommendations", async (_req, res) => {
  try {
    const records = await fetchRecords();
    return res.json({ recommendations: getRecommendations(records) });
  } catch (err) {
    logger.error({ err }, "Failed to build recommendations");
    return res.status(502).json({ error: "Failed to fetch data from Google Sheets" });
  }
});

/**
 * GET /api/insights/at-risk
 * Early warning for currently-healthy CSPs (0-2 days) trending toward the
 * 3-day threshold or with a relapse history — two disclosed rules, not a
 * statistical/ML model.
 */
router.get("/insights/at-risk", async (_req, res) => {
  try {
    const records = await fetchRecords();
    return res.json({ atRisk: getAtRiskCsps(records) });
  } catch (err) {
    logger.error({ err }, "Failed to build at-risk list");
    return res.status(502).json({ error: "Failed to fetch data from Google Sheets" });
  }
});

const dailyChangesQuerySchema = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD")
    .optional(),
});

/**
 * GET /api/daily-changes[?day=YYYY-MM-DD]
 * The named audit trail behind the daily-change numbers: which specific CSPs
 * went active -> inactive today, and which recovered — not just counts.
 * Defaults to today. Populated once per real daily-job run (see dailyJob.ts);
 * a day nothing ran on simply returns empty arrays, not an error.
 */
router.get("/daily-changes", (req, res) => {
  const parsed = dailyChangesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }
  try {
    return res.json(getDailyChanges(parsed.data.day));
  } catch (err) {
    logger.error({ err }, "Failed to load daily changes");
    return res.status(500).json({ error: "Failed to load daily changes" });
  }
});

/**
 * GET /api/adaptive-tuning
 * The self-tuning nudge cap's current value, its fixed safety bounds, and
 * the audited history of every evaluation (including "no change" ones) that
 * got it there — see adaptiveTuning.service.ts.
 */
router.get("/adaptive-tuning", (_req, res) => {
  try {
    return res.json(getTuningReport());
  } catch (err) {
    logger.error({ err }, "Failed to load adaptive tuning report");
    return res.status(500).json({ error: "Failed to load adaptive tuning report" });
  }
});

/**
 * GET /api/settings
 * The effective runtime configuration: saved dashboard overrides layered on
 * the .env defaults (settings.service.ts). Always returns a complete object,
 * never a partial one, so the settings form can render straight from it.
 */
router.get("/settings", (_req, res) => {
  try {
    return res.json(getSettings());
  } catch (err) {
    logger.error({ err }, "Failed to load settings");
    return res.status(500).json({ error: "Failed to load settings" });
  }
});

/**
 * Every field is optional — a save writes only what it sends, so one panel
 * can never clobber a key it doesn't show. Bounds are deliberately narrow
 * and enforced HERE rather than in the UI alone: these numbers decide who
 * gets messaged and how often, and a 0-day cooldown or a 500-nudge cap
 * typed into a raw POST would be a real harm, not just a bad form entry.
 */
const settingsSchema = z
  .object({
    emailEnabled: z.boolean(),
    emailDraftOnly: z.boolean(),
    whatsappEnabled: z.boolean(),
    inactivityThresholdDays: z.number().int("Must be a whole number of days").min(1).max(365),
    targetInactivityRate: z.number().min(0).max(100),
    cspMaxNudges: z.number().int("Must be a whole number of nudges").min(1).max(10),
    cspNudgeCooldownDays: z.number().int("Must be a whole number of days").min(1).max(30),
  })
  .partial()
  .strict();

/**
 * POST /api/settings
 * Saves configuration overrides and returns the full effective settings.
 * Saving the nudge cap also clears the adaptively-tuned value, so the number
 * the operator just typed is the one actually in force (see
 * resetTunedMaxNudges) rather than being silently overridden by tuning_state.
 */
router.post("/settings", (req, res) => {
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    // The whole flatten(), not just fieldErrors: a rejected unknown key lands
    // in formErrors, and reporting only fieldErrors would answer that with a
    // bare `{}` — a 400 with no stated reason.
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "No settings supplied." });
  }

  try {
    const saved = updateSettings(parsed.data);
    if (parsed.data.cspMaxNudges !== undefined) resetTunedMaxNudges();
    logger.info({ changed: Object.keys(parsed.data) }, "Dashboard settings updated");
    return res.json(saved);
  } catch (err) {
    logger.error({ err }, "Failed to save settings");
    return res.status(500).json({ error: "Failed to save settings" });
  }
});

/**
 * GET /api/templates
 * Every outbound message template — its current effective text (saved
 * override, else the built-in default), plus the metadata the frontend needs
 * to render an editor safely: which placeholders are required, sample values
 * for a live preview, and whether it's locked behind an approved WhatsApp
 * business template (see templates.service.ts's file-level note).
 */
router.get("/templates", (_req, res) => {
  try {
    return res.json({ templates: getAllTemplates() });
  } catch (err) {
    logger.error({ err }, "Failed to load templates");
    return res.status(500).json({ error: "Failed to load templates" });
  }
});

const templatesSchema = z
  .object({}) // keys are dynamic (template keys) — validated against the registry below, not by zod shape
  .catchall(z.string())
  .refine((obj) => Object.keys(obj).length > 0, { message: "No templates supplied." });

/**
 * POST /api/templates
 * Saves one or more templates by key. Rejects (400) any value that has
 * dropped a placeholder its renderer depends on (e.g. removing {{days}} from
 * the CSP WhatsApp nudge) — a silently broken message is worse than a
 * rejected save. Unknown keys are also rejected rather than silently stored.
 */
router.post("/templates", (req, res) => {
  const parsed = templatesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    updateTemplates(parsed.data);
    logger.info({ changed: Object.keys(parsed.data) }, "Message templates updated");
    return res.json({ templates: getAllTemplates() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save templates";
    logger.error({ err }, "Failed to save templates");
    return res.status(400).json({ error: message });
  }
});

/** POST /api/templates/:key/reset - drops the saved override, reverting to the built-in default. */
router.post("/templates/:key/reset", (req, res) => {
  try {
    resetTemplate(req.params.key);
    return res.json({ templates: getAllTemplates() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reset template";
    return res.status(400).json({ error: message });
  }
});

/**
 * GET /api/message-reach[?jobRunId=]
 * How many CSPs were messaged directly, and how many distinct RMs/DCs were
 * reached (each counted once no matter how many CSPs they cover) — with the
 * full per-recipient breakdown for drill-down. Defaults to the most recent
 * run, same convention as /api/delivery-summary.
 */
router.get("/message-reach", (req, res) => {
  const raw = req.query.jobRunId;
  if (raw !== undefined) {
    const jobRunId = Number(raw);
    if (!Number.isInteger(jobRunId) || jobRunId <= 0) {
      return res.status(400).json({ error: "jobRunId must be a positive integer" });
    }
    return res.json(getMessageReach(jobRunId));
  }
  return res.json(getMessageReach());
});

/**
 * GET /api/email-drafts
 * Emails composed while `emailDraftOnly` was on (settings.service.ts) —
 * exactly what would have been sent, saved instead. Most recent first.
 * Nothing here was ever attempted for real delivery, so it's not part of
 * delivery-summary or message-reach.
 */
router.get("/email-drafts", (_req, res) => {
  try {
    return res.json({ drafts: getEmailDrafts() });
  } catch (err) {
    logger.error({ err }, "Failed to load email drafts");
    return res.status(500).json({ error: "Failed to load email drafts" });
  }
});

/**
 * POST /api/csps/:cspCode/nudge
 * A deliberate, human-initiated single-CSP nudge — sends the real WhatsApp
 * reminder to just this one CSP right now, bypassing the automated
 * cadence/cap (but never the terminal-active / suppressed-by-reply safety
 * rules). The frontend gates this behind its own confirm step; this route
 * itself does not — same pattern as /job-runs/trigger.
 */
router.post("/csps/:cspCode/nudge", async (req, res) => {
  const cspCode = req.params.cspCode;
  try {
    const result = await sendOneOffNudge(cspCode, new Date().toISOString());
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    logger.error({ err, cspCode }, "One-off nudge request failed");
    return res.status(500).json({ success: false, cspCode, personName: "", error: "Nudge failed unexpectedly." });
  }
});

/**
 * GET /api/delivery-summary[?jobRunId=123]
 * Who we alerted on a run, what was delivered, and what failed.
 * Defaults to the most recent run.
 */
router.get("/delivery-summary", (req, res) => {
  const raw = req.query.jobRunId;
  if (raw !== undefined) {
    const jobRunId = Number(raw);
    if (!Number.isInteger(jobRunId) || jobRunId <= 0) {
      return res.status(400).json({ error: "jobRunId must be a positive integer" });
    }
    return res.json(getDeliverySummary(jobRunId));
  }
  return res.json(getDeliverySummary());
});

/** GET /api/job-runs - recent daily job execution history (audit trail) */
router.get("/job-runs", (_req, res) => {
  res.json(getRecentJobRuns());
});

/** GET /api/job-runs/:id/alerts - individual notification outcomes for a run */
router.get("/job-runs/:id/alerts", (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "invalid job run id" });
  }
  return res.json(getAlertsForRun(id));
});

/** POST /api/job-runs/trigger - manually trigger the daily pipeline on demand */
router.post("/job-runs/trigger", async (_req, res) => {
  try {
    const result = await runDailyInactivityJob();
    return res.status(202).json(result);
  } catch (err) {
    logger.error({ err }, "Manual job trigger failed");
    return res.status(500).json({ error: "Job execution failed" });
  }
});

/**
 * A standalone delivery test: sends a sample email and/or WhatsApp to a chosen
 * contact and reports whether each channel landed. It does NOT read the
 * spreadsheet, evaluate tiers, or message any real CSP/RM/DC — it only checks
 * that the SMTP and WhatsApp credentials actually deliver. At least one of
 * email or mobile must be provided.
 */
const testDeliverySchema = z.object({
  email: z.string().trim().email().optional().or(z.literal("")),
  mobile: z.string().trim().optional().or(z.literal("")),
});

router.post("/test-delivery", async (req, res) => {
  const parsed = testDeliverySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  const email = parsed.data.email || "";
  const mobile = normalizeMobile(parsed.data.mobile || "");
  if (!email && !mobile) {
    return res.status(400).json({ error: "Provide an email, a mobile, or both to test." });
  }

  try {
    const result = await runTestDelivery(email, mobile);
    return res.status(200).json(result);
  } catch (err) {
    logger.error({ err }, "Test delivery failed");
    return res.status(500).json({ error: "Test delivery failed" });
  }
});

/**
 * GET /api/email/track
 * Serves a transparent 1x1 GIF and updates the alert's status to 'read' in the audit log.
 */
router.get("/email/track", (req, res) => {
  const messageId = req.query.messageId;

  if (typeof messageId === "string" && messageId) {
    try {
      updateAlertDeliveryStatus(messageId, "read");
      logger.info({ messageId }, "Email read status tracked successfully");
    } catch (err) {
      logger.error({ err, messageId }, "Failed to update email status on track");
    }
  }

  // 1x1 transparent GIF
  const transparentGif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );

  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": transparentGif.length,
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
  });
  res.end(transparentGif);
});

export default router;
