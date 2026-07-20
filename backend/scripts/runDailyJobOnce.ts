import logger from "../src/utils/logger";
import { runDailyInactivityJob } from "../src/jobs/dailyJob";

/**
 * Standalone entry point that runs the ingestion + alert pipeline exactly
 * once, then exits. Intended for use with an OS-level scheduler (Windows
 * Task Scheduler, cron, a CI pipeline schedule) as an alternative to the
 * always-on server's built-in node-cron scheduler.
 */
runDailyInactivityJob()
  .then((result) => {
    logger.info(
      { matched: result.totalAlertsMatched, notifications: result.notifications.length },
      "One-off daily job run finished",
    );
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "One-off daily job run failed");
    process.exit(1);
  });
