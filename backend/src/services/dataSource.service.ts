import env from "../config/env";
import { InactivityRecord } from "../types";
import { fetchFromExcel, invalidateExcelCache } from "./excelSource.service";
import {
  fetchFromGoogleCallingSheet,
  invalidateGoogleCallingSheetCache,
} from "./googleCallingSheet.service";

/**
 * Single entry point for CSP data. Both sources read the SAME "Calling Sheet
 * New" layout via the shared parser, so switching DATA_SOURCE changes only
 * where the bytes come from — never the shape of the records.
 */
export async function fetchRecords(force = false): Promise<InactivityRecord[]> {
  if (env.DATA_SOURCE === "google") {
    return fetchFromGoogleCallingSheet(force);
  }
  return fetchFromExcel(force);
}

export function invalidateCache(): void {
  invalidateExcelCache();
  invalidateGoogleCallingSheetCache();
}
