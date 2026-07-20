import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import env from "../config/env";
import { InactivityRecord } from "../types";
import {
  CellValue,
  LAST_COL_INDEX,
  SHEET_NAME,
  recordsFromGrid,
} from "./callingSheet.parser";

/**
 * Reads the "Calling Sheet New" tab from a local .xlsx file and hands the raw
 * grid to the shared calling-sheet parser. All layout knowledge lives in
 * callingSheet.parser.ts so the Excel and Google adapters stay identical.
 */

function extractGrid(ws: ExcelJS.Worksheet): CellValue[][] {
  const grid: CellValue[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: CellValue[] = [];
    for (let c = 1; c <= LAST_COL_INDEX + 1; c++) {
      const v = row.getCell(c).value;
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        // Rich text / formula / hyperlink objects -> their display text.
        if ("text" in v) cells.push(String((v as { text: unknown }).text));
        else if ("result" in v) cells.push((v as { result: CellValue }).result ?? null);
        else cells.push(null);
      } else {
        cells.push(v as CellValue);
      }
    }
    grid.push(cells);
  }
  return grid;
}

let cached: InactivityRecord[] | null = null;
let cachedAt = 0;

export async function fetchFromExcel(force = false): Promise<InactivityRecord[]> {
  const now = Date.now();
  if (!force && cached && now - cachedAt < env.SHEET_CACHE_TTL_MS) return cached;

  const file = path.resolve(env.EXCEL_FILE_PATH);
  if (!fs.existsSync(file)) {
    throw new Error(`Excel source not found at ${file} (set EXCEL_FILE_PATH)`);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found in ${file}`);

  const records = await recordsFromGrid(extractGrid(ws), `excel:${path.basename(file)}`);
  cached = records;
  cachedAt = now;
  return records;
}

export function invalidateExcelCache(): void {
  cached = null;
  cachedAt = 0;
}
