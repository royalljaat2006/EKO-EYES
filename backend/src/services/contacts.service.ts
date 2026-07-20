import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import env from "../config/env";
import logger from "../utils/logger";
import { Contact } from "../types";

/**
 * Maps an RM or DC *name* (all the Calling Sheet gives us) to the email and
 * mobile we need in order to actually reach them.
 *
 * The Calling Sheet contains no RM/DC contact details whatsoever, so without
 * this mapping the agent has nobody to send to. Rather than guess at addresses
 * — a wrong address means an alert silently goes nowhere, which is worse than
 * no alert — unresolved names are reported loudly and skipped.
 *
 * Source: an xlsx with columns Role | Name | Email | Mobile Number.
 * Generate a pre-filled template with `npm run contacts:template`.
 */

type Key = string;

const keyOf = (role: "RM" | "DC", name: string): Key =>
  `${role}|${name.trim().toLowerCase()}`;

let cache: Map<Key, Contact> | null = null;

function normalizeMobile(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  // Excel stores phone numbers as floats (9973531951.0), so coerce carefully.
  let s = typeof raw === "number" ? raw.toFixed(0) : String(raw).trim();
  s = s.replace(/\.0+$/, "").replace(/[\s\-()]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  // 10-digit Indian numbers arrive without a country code.
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

export function normalizeCspMobile(raw: unknown): string {
  return normalizeMobile(raw);
}

async function load(): Promise<Map<Key, Contact>> {
  const file = path.resolve(env.CONTACTS_FILE_PATH);
  const map = new Map<Key, Contact>();

  if (!fs.existsSync(file)) {
    logger.warn(
      { file },
      "No contacts file found — RM/DC alerts cannot be sent. Run `npm run contacts:template` and fill it in.",
    );
    return map;
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const role = String(row.getCell(1).value ?? "").trim().toUpperCase();
    const name = String(row.getCell(2).value ?? "").trim();
    const emailCell = row.getCell(3).value;
    const email =
      typeof emailCell === "object" && emailCell !== null && "text" in emailCell
        ? String((emailCell as { text: unknown }).text).trim()
        : String(emailCell ?? "").trim();
    const mobile = normalizeMobile(row.getCell(4).value);

    if ((role !== "RM" && role !== "DC") || !name) return;
    if (!email && !mobile) return; // nothing to reach them on

    map.set(keyOf(role, name), { name, email, mobile });
  });

  logger.info({ file, contacts: map.size }, "Loaded RM/DC contacts");
  return map;
}

export async function getContacts(force = false): Promise<Map<Key, Contact>> {
  if (!cache || force) cache = await load();
  return cache;
}

export async function resolveContact(
  role: "RM" | "DC",
  name: string,
): Promise<Contact | null> {
  if (!name || !name.trim()) return null;
  const contacts = await getContacts();
  return contacts.get(keyOf(role, name)) ?? null;
}

export function invalidateContactsCache(): void {
  cache = null;
}
