import path from "node:path";
import ExcelJS from "exceljs";
import env from "../src/config/env";
import logger from "../src/utils/logger";
import { fetchFromExcel } from "../src/services/excelSource.service";

/**
 * The Calling Sheet has RM/DC *names* but no contact details, so the agent has
 * nobody to send to. This writes a contacts workbook pre-filled with every RM
 * and DC name found in the sheet — someone just fills in email + mobile.
 */
async function main() {
  const records = await fetchFromExcel(true);

  const rms = new Map<string, number>();
  const dcs = new Map<string, number>();
  for (const r of records) {
    if (r.rmName) rms.set(r.rmName, (rms.get(r.rmName) ?? 0) + 1);
    if (r.dcName) dcs.set(r.dcName, (dcs.get(r.dcName) ?? 0) + 1);
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Contacts");
  ws.columns = [
    { header: "Role", key: "role", width: 8 },
    { header: "Name", key: "name", width: 26 },
    { header: "Email", key: "email", width: 32 },
    { header: "Mobile Number", key: "mobile", width: 18 },
    { header: "CSPs Assigned", key: "count", width: 15 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const sorted = (m: Map<string, number>) =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1]);

  for (const [name, count] of sorted(rms)) {
    ws.addRow({ role: "RM", name, email: "", mobile: "", count });
  }
  for (const [name, count] of sorted(dcs)) {
    ws.addRow({ role: "DC", name, email: "", mobile: "", count });
  }

  const out = path.resolve(env.CONTACTS_FILE_PATH);
  await wb.xlsx.writeFile(out);

  logger.info(
    { out, rms: rms.size, dcs: dcs.size },
    "Contacts template written — fill in Email and Mobile Number, then re-run the job",
  );
}

main().catch((err) => {
  logger.error({ err }, "Failed to generate contacts template");
  process.exit(1);
});
