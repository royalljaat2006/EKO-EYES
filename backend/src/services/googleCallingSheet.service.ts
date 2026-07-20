import fs from "node:fs";
import { google } from "googleapis";
import env from "../config/env";
import { InactivityRecord } from "../types";
import { CellValue, SHEET_NAME, recordsFromGrid } from "./callingSheet.parser";

/**
 * Reads the "Calling Sheet New" tab from a live Google Sheet and hands the raw
 * grid to the shared calling-sheet parser — the same parser the Excel adapter
 * uses, so both sources produce identical records.
 *
 * Requires a service account (read-only Sheets scope) with the spreadsheet
 * shared to its email as Viewer. See README "Connecting Google Sheets".
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// Read A:AZ of the tab (the live sheet spreads contact + status columns wider
// than the Excel export). Dates come back as serial numbers, text stays text —
// the shared parser handles both.
const RANGE = `${SHEET_NAME}!A:AZ`;

function loadCredentials() {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    const json = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8");
    return JSON.parse(json);
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(fs.readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  }
  throw new Error("No Google service account credentials configured");
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
  return google.sheets({ version: "v4", auth });
}

let cached: InactivityRecord[] | null = null;
let cachedAt = 0;

export async function fetchFromGoogleCallingSheet(force = false): Promise<InactivityRecord[]> {
  const now = Date.now();
  if (!force && cached && now - cachedAt < env.SHEET_CACHE_TTL_MS) return cached;

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: RANGE,
    // UNFORMATTED gives real numbers (mobiles, date serials); the parser copes.
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });

  const grid = (res.data.values ?? []) as CellValue[][];
  const records = await recordsFromGrid(grid, `google:${env.GOOGLE_SHEETS_SPREADSHEET_ID}`);
  cached = records;
  cachedAt = now;
  return records;
}

export function invalidateGoogleCallingSheetCache(): void {
  cached = null;
  cachedAt = 0;
}
