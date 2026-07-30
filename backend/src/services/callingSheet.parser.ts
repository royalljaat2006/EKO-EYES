import { InactivityRecord, Contact } from "../types";
import { normalizeCspMobile, resolveContact } from "./contacts.service";
import logger from "../utils/logger";

/**
 * Shared parsing logic for the EKO "Calling Sheet New" layout, used by BOTH the
 * Excel adapter and the Google Sheets adapter so the two produce identical
 * records. Operates on a plain grid of cell values, so it does not care whether
 * those came from ExcelJS or the Sheets API.
 *
 * Columns are matched BY HEADER NAME (on row 2), not by fixed position. The
 * local Excel export and the live Google sheet have the same headers in
 * DIFFERENT columns (the Google sheet has extra columns — Gender, CSP Mail ID,
 * RM/DC email + mobile — that shift everything), so a positional map cannot
 * serve both. Name-matching also survives future column insertions.
 *
 * Quirks handled:
 *  - Header row is the 2nd row (row 1 holds merged group labels).
 *  - "Inactivity Days" is TEXT ("3 Days inactive"), not a number.
 *  - "No transaction data" means UNKNOWN, not zero.
 *  - Mobiles are stored as numbers (9973531951).
 *  - The live sheet carries RM/DC email + mobile inline; the Excel export does
 *    not, so RM/DC contacts fall back to the contacts file when absent.
 */

export type CellValue = string | number | boolean | Date | null | undefined;

export const SHEET_NAME = "Calling Sheet New";
export const HEADER_ROW_INDEX = 1; // 0-based: the 2nd row
export const FIRST_DATA_ROW_INDEX = 2; // 0-based: the 3rd row

/** How many columns to read from the source (covers the live sheet's spread). */
export const LAST_COL_INDEX = 45;

type Field =
  | "cspCode"
  | "cspName"
  | "cspMobile"
  | "rmName"
  | "rmEmail"
  | "rmMobile"
  | "dcName"
  | "dcEmail"
  | "dcMobile"
  | "lhoName"
  | "lhoEmail"
  | "state"
  | "district"
  | "terminalStatus"
  | "inactivityDays"
  | "lastLoginDate";

type ColumnMap = Record<Field, number>;

const REQUIRED: Field[] = ["cspCode", "cspName", "inactivityDays"];

/** Header matchers on the normalised (trimmed, lower-cased) header text. */
const MATCHERS: Record<Field, (h: string) => boolean> = {
  cspCode: (h) => h === "csp code",
  cspName: (h) => h === "csp name",
  // Exact match, not startsWith — must NOT catch "mobile number dc". The Excel
  // export used a plain "Mobile Number" header; the live Google Sheet renamed
  // it to "CSP Mobile Number" during the source migration but the matcher was
  // never updated, so this column resolved to -1 for every row and every CSP's
  // mobile silently read as empty (blocking 100% of CSP WhatsApp sends via the
  // "no-mobile" guardrail in cspEngagement.service.ts, indistinguishable from
  // the guardrail actually doing its job). Both header spellings are matched
  // now so either source works.
  cspMobile: (h) => h === "mobile number" || h === "csp mobile number",
  rmName: (h) => h === "relationship manager",
  rmEmail: (h) => h.startsWith("email of rm"),
  rmMobile: (h) => h.startsWith("mobile no of rm") || h.startsWith("mobile number rm"),
  dcName: (h) => h === "district coordinator",
  dcEmail: (h) => h.startsWith("email id dc") || h.startsWith("email of dc"),
  dcMobile: (h) => h.startsWith("mobile number dc") || h.startsWith("mobile no of dc"),
  lhoName: (h) => h === "circle (lho)",
  lhoEmail: (h) => h.startsWith("lho mail"),
  state: (h) => h === "state",
  district: (h) => h === "district",
  terminalStatus: (h) => h === "terminal status",
  inactivityDays: (h) => h.startsWith("inactivity days"),
  lastLoginDate: (h) => h.startsWith("last login"),
};

export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

const norm = (v: CellValue): string => cellText(v).toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Resolves each field to a column index by matching header names. Throws if a
 * REQUIRED column is missing (a real layout break); optional columns that are
 * absent resolve to -1 and are simply read as empty.
 */
export function resolveColumns(headerRow: CellValue[]): ColumnMap {
  const map = {} as ColumnMap;
  for (const field of Object.keys(MATCHERS) as Field[]) {
    map[field] = headerRow.findIndex((cell) => MATCHERS[field](norm(cell)));
  }

  const missing = REQUIRED.filter((f) => map[f] === -1);
  if (missing.length > 0) {
    throw new Error(
      `Calling Sheet is missing required column(s): ${missing.join(", ")}. ` +
        `Found headers: [${headerRow.map((c) => cellText(c)).filter(Boolean).join(", ")}]`,
    );
  }
  return map;
}

/**
 * Tolerant parse of the inactivity cell. Returns null for "unknown"
 * (e.g. "No transaction data") rather than pretending it is zero.
 */
export function parseInactivityDays(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/no\s+transaction\s+data/i.test(s)) return null;
  const m = s.match(/-?\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Best-effort parse of the last-login cell into a YYYY-MM-DD string, or null. */
export function parseLastLogin(value: CellValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // Google Sheets serial date number (days since 1899-12-30).
  if (typeof value === "number" && value > 0) {
    const ms = Math.round((value - 25569) * 86_400_000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const at = (row: CellValue[], col: number): CellValue => (col >= 0 ? row[col] : undefined);

/** True for a fully blank data row (no code, no name). */
function isBlankRow(row: CellValue[], cols: ColumnMap): boolean {
  return !cellText(at(row, cols.cspCode)) && !cellText(at(row, cols.cspName));
}

/**
 * Builds an RM/DC contact from inline sheet columns when present, otherwise
 * falls back to the name→contact mapping file. The live Google sheet carries
 * the contact inline; the Excel export does not.
 */
async function resolveRoleContact(
  role: "RM" | "DC",
  name: string,
  email: string,
  mobile: string,
): Promise<Contact | null> {
  if (email || mobile) {
    return { name: name || email, email, mobile: mobile ? normalizeCspMobile(mobile) : "" };
  }
  return resolveContact(role, name);
}

function buildRecord(
  row: CellValue[],
  cols: ColumnMap,
  sourceRow: number,
  rm: Contact | null,
  dc: Contact | null,
): InactivityRecord {
  const cspCode = cellText(at(row, cols.cspCode));
  const cspName = cellText(at(row, cols.cspName));
  const daysRaw = cellText(at(row, cols.inactivityDays));

  return {
    cspCode,
    targetPersonName: cspName || cspCode,
    cspMobile: normalizeCspMobile(at(row, cols.cspMobile)),
    days: parseInactivityDays(daysRaw),
    daysRaw,
    rmName: cellText(at(row, cols.rmName)),
    dcName: cellText(at(row, cols.dcName)),
    rm,
    dc,
    lhoName: cellText(at(row, cols.lhoName)),
    lhoEmail: cellText(at(row, cols.lhoEmail)),
    state: cellText(at(row, cols.state)),
    district: cellText(at(row, cols.district)),
    terminalStatus: cellText(at(row, cols.terminalStatus)),
    lastLoginDate: parseLastLogin(at(row, cols.lastLoginDate)),
    sourceRow,
  };
}

/**
 * Turns a full grid (row 0 = the sheet's row 1) into records: resolves columns
 * by header name, skips blanks, resolves each RM/DC contact (inline or from the
 * file), and logs data quality. Shared by the Excel and Google adapters.
 */
export async function recordsFromGrid(
  grid: CellValue[][],
  sourceLabel: string,
): Promise<InactivityRecord[]> {
  if (grid.length <= HEADER_ROW_INDEX) {
    logger.warn({ source: sourceLabel }, "Calling sheet returned no data rows");
    return [];
  }

  const cols = resolveColumns(grid[HEADER_ROW_INDEX]);
  const hasInlineRm = cols.rmEmail >= 0 || cols.rmMobile >= 0;
  const hasInlineDc = cols.dcEmail >= 0 || cols.dcMobile >= 0;

  const records: InactivityRecord[] = [];
  let unknownDays = 0;
  let unresolvedRm = 0;
  let unresolvedDc = 0;

  for (let i = FIRST_DATA_ROW_INDEX; i < grid.length; i++) {
    const row = grid[i];
    if (!row || isBlankRow(row, cols)) continue;

    const rmName = cellText(at(row, cols.rmName));
    const dcName = cellText(at(row, cols.dcName));
    const rm = await resolveRoleContact(
      "RM",
      rmName,
      cellText(at(row, cols.rmEmail)),
      cellText(at(row, cols.rmMobile)),
    );
    const dc = await resolveRoleContact(
      "DC",
      dcName,
      cellText(at(row, cols.dcEmail)),
      cellText(at(row, cols.dcMobile)),
    );
    if (rmName && !rm) unresolvedRm++;
    if (dcName && !dc) unresolvedDc++;

    const record = buildRecord(row, cols, i + 1, rm, dc); // i+1 = 1-based sheet row
    if (record.days === null) unknownDays++;
    records.push(record);
  }

  logger.info(
    {
      source: sourceLabel,
      records: records.length,
      unknownDays,
      contactsInline: { rm: hasInlineRm, dc: hasInlineDc },
      unresolvedRmNames: unresolvedRm,
      unresolvedDcNames: unresolvedDc,
    },
    "Ingested CSP records from calling sheet",
  );
  if (unresolvedRm > 0 || unresolvedDc > 0) {
    logger.warn(
      { unresolvedRm, unresolvedDc },
      "Some RM/DC have no contact details (not in the sheet, not in the contacts file) — those alerts cannot be sent.",
    );
  }

  return records;
}
