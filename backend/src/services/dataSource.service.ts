import env from "../config/env";
import { InactivityRecord } from "../types";
import { fetchFromExcel, invalidateExcelCache } from "./excelSource.service";
import {
  fetchFromGoogleCallingSheet,
  invalidateGoogleCallingSheetCache,
} from "./googleCallingSheet.service";

let lastFetchedAt = 0;

/**
 * Single entry point for CSP data. Both sources read the SAME "Calling Sheet
 * New" layout via the shared parser, so switching DATA_SOURCE changes only
 * where the bytes come from — never the shape of the records.
 *
 * READ-ONLY, deliberately. This used to also call `syncInactivityState()`,
 * which detected recoveries and rewrote `person_state` — on a function that
 * runs every minute (sheet refresh) AND on every dashboard API request. That
 * silently destroyed the day-over-day baseline the noon job needs: by the
 * time the job ran, "yesterday's tier" had already been overwritten with
 * today's, so nobody ever looked like they'd changed. Onset logging died
 * (empty for weeks) and new_breaches/newly_inactive sat at 0 forever.
 *
 * SKILLS.md ("Fast raw refresh, slow-cadence logic") already required this
 * separation; the code had drifted from it. State comparison now lives in
 * exactly one place — the daily job, via dailySnapshot.service.ts. Do not
 * reintroduce writes here.
 */
export async function fetchRecords(force = false): Promise<InactivityRecord[]> {
  const isDev = env.NODE_ENV === "development";
  const ttl = isDev ? 0 : env.SHEET_CACHE_TTL_MS;
  const now = Date.now();

  if (force || now - lastFetchedAt >= ttl) {
    lastFetchedAt = now;
  }

  if (env.DATA_SOURCE === "google") {
    return await fetchFromGoogleCallingSheet(force);
  }
  return await fetchFromExcel(force);
}

export function invalidateCache(): void {
  invalidateExcelCache();
  invalidateGoogleCallingSheetCache();
}
