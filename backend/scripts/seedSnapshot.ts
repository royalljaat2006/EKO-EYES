/**
 * Writes a roster snapshot for a given day (default: today) from the CURRENT
 * sheet, without running the daily job or sending anything.
 *
 * Needed once when the snapshot baseline is first introduced: the daily job
 * can only report day-over-day change if a PREVIOUS day's snapshot exists, so
 * without seeding, the first run after deploy would honestly report "no
 * baseline yet" and only the run after that would produce real numbers. Also
 * useful to re-freeze a day if a snapshot was lost.
 *
 * Usage:  npx tsx scripts/seedSnapshot.ts [YYYY-MM-DD]
 */
import logger from "../src/utils/logger";
import { fetchRecords } from "../src/services/dataSource.service";
import {
  saveDailySnapshot,
  snapshotDayCount,
  previousSnapshotDay,
} from "../src/services/dailySnapshot.service";

async function main() {
  const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Day must be YYYY-MM-DD, got "${day}"`);
  }

  const records = await fetchRecords(true);
  saveDailySnapshot(day, records);

  const flagged = records.filter((r) => r.days !== null && r.days >= 3).length;
  logger.info(
    {
      day,
      records: records.length,
      flaggedAtSnapshot: flagged,
      totalSnapshotDays: snapshotDayCount(),
      previousSnapshotDay: previousSnapshotDay(day),
    },
    "Roster snapshot written — this is now the baseline future runs compare against",
  );
}

main().catch((err) => {
  logger.error({ err }, "Failed to seed roster snapshot");
  process.exit(1);
});
