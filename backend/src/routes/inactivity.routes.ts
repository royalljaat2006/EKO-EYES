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
import { getKpiReport } from "../services/kpi.service";
import { fetchRecords } from "../services/dataSource.service";
import { runTestDelivery } from "../services/testDelivery.service";
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
