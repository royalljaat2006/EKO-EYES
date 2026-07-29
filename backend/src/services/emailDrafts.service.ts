import db from "./alertStore.service";
import { NotificationRole } from "../types";

/**
 * Where a composed email lands when `emailDraftOnly` is on
 * (settings.service.ts) — the exact subject/body the pipeline built, saved
 * instead of sent, so an operator can check the wording is right before
 * flipping back to live sending. Separate from `alert_log` on purpose: a
 * draft was never attempted for real delivery, so it must never count
 * toward sent/failed/reach numbers — those tables answer "did it arrive?",
 * this one answers "what would have gone out?".
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS email_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_run_id INTEGER,
    role TEXT NOT NULL,
    recipient TEXT NOT NULL,
    recipient_name TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    csp_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_email_drafts_created_at ON email_drafts(created_at);
`);

export interface EmailDraft {
  id: number;
  jobRunId: number | null;
  role: NotificationRole;
  recipient: string;
  recipientName: string | null;
  subject: string;
  body: string;
  cspCount: number;
  createdAt: string;
}

interface DraftRow {
  id: number;
  job_run_id: number | null;
  role: NotificationRole;
  recipient: string;
  recipient_name: string | null;
  subject: string;
  body: string;
  csp_count: number;
  created_at: string;
}

const toDraft = (r: DraftRow): EmailDraft => ({
  id: r.id,
  jobRunId: r.job_run_id,
  role: r.role,
  recipient: r.recipient,
  recipientName: r.recipient_name,
  subject: r.subject,
  body: r.body,
  cspCount: r.csp_count,
  createdAt: r.created_at,
});

export function saveEmailDraft(draft: {
  jobRunId: number | null;
  role: NotificationRole;
  recipient: string;
  recipientName: string | null;
  subject: string;
  body: string;
  cspCount: number;
  now: string;
}): void {
  db.prepare(
    `INSERT INTO email_drafts (job_run_id, role, recipient, recipient_name, subject, body, csp_count, created_at)
     VALUES (@jobRunId, @role, @recipient, @recipientName, @subject, @body, @cspCount, @now)`,
  ).run(draft);
}

/** Most recent drafts first — bounded by `limit` since a run can generate one draft per RM/DC/Support recipient. */
export function getEmailDrafts(limit = 200): EmailDraft[] {
  const rows = db
    .prepare(`SELECT * FROM email_drafts ORDER BY id DESC LIMIT ?`)
    .all(limit) as DraftRow[];
  return rows.map(toDraft);
}

export function countEmailDrafts(): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM email_drafts`).get() as { c: number }).c;
}
