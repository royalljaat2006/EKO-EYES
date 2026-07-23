import cron from "node-cron";
import env from "../config/env";
import logger from "../utils/logger";
import { runDailyInactivityJob } from "./dailyJob";
import { runSheetRefresh } from "./sheetRefresh";

export function startScheduler(): void {
  if (!cron.validate(env.SHEET_REFRESH_CRON)) {
    throw new Error(`Invalid SHEET_REFRESH_CRON expression: ${env.SHEET_REFRESH_CRON}`);
  }
  if (!cron.validate(env.DAILY_JOB_CRON)) {
    throw new Error(`Invalid DAILY_JOB_CRON expression: ${env.DAILY_JOB_CRON}`);
  }

  // Every 1 minute (default) — refresh + validate the spreadsheet. Sends
  // nothing; keeps the dashboard's data fresh and catches a broken sheet
  // connection well before the noon send.
  cron.schedule(
    env.SHEET_REFRESH_CRON,
    () => {
      runSheetRefresh().catch((err) => {
        logger.error({ err }, "Sheet refresh crashed");
      });
    },
    { timezone: env.TIMEZONE },
  );

  // 12:00 PM — the real send: ingest, tier, apply guardrails, notify.
  cron.schedule(
    env.DAILY_JOB_CRON,
    () => {
      runDailyInactivityJob().catch((err) => {
        logger.error({ err }, "Daily inactivity job crashed");
      });
    },
    { timezone: env.TIMEZONE },
  );

  logger.info(
    {
      sheetRefresh: env.SHEET_REFRESH_CRON,
      dailySend: env.DAILY_JOB_CRON,
      timezone: env.TIMEZONE,
    },
    "Scheduler started: recurring spreadsheet refresh + daily alert send",
  );
}
