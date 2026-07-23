import logger from "../utils/logger";
import { fetchRecords, invalidateCache } from "../services/dataSource.service";
import { invalidateContactsCache } from "../services/contacts.service";
import { known, unknownCount } from "../services/inactivity.service";
import { tierForDays } from "../config/escalation";

/**
 * Runs every 1 minute (SHEET_REFRESH_CRON) so the dashboard is never showing
 * data much older than that, and so a broken spreadsheet connection or a
 * shifted column layout is caught well before the noon send.
 *
 * It re-reads the live sheet and refreshes the cache — this IS the "update"
 * the dashboard runs on between sends — but it never sends a single
 * notification itself. Only the noon job (dailyJob.ts) does that. Recovery/
 * onset detection and adaptive tuning also stay on the once-daily cadence —
 * see SKILLS.md ("Fast raw refresh, slow-cadence logic").
 */
export async function runSheetRefresh(): Promise<void> {
  logger.info("Sheet refresh starting — re-reading the live spreadsheet");

  try {
    invalidateCache();
    invalidateContactsCache();
    const records = await fetchRecords(true);
    const measurable = known(records);

    const tierCounts: Record<string, number> = {};
    for (const r of measurable) {
      const tier = tierForDays(r.days)?.tier ?? "healthy";
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    }

    logger.info(
      {
        totalRecords: records.length,
        measurable: measurable.length,
        unknownDays: unknownCount(records),
        tierCounts,
      },
      "Sheet refresh passed — spreadsheet is readable, cache refreshed",
    );
  } catch (err) {
    logger.error(
      { err },
      "Sheet refresh FAILED — the spreadsheet could not be read. " +
        "Fix this before the scheduled send or today's alerts will fail too.",
    );
  }
}
