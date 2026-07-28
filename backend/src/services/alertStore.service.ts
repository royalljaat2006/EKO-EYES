import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import env from "../config/env";
import {
  DailyJobResult,
  DeliverySummary,
  NotificationChannel,
  NotificationRole,
  PersonDeliveryStatus,
} from "../types";

const dbPath = path.resolve(env.SQLITE_DB_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL,
    total_ingested INTEGER NOT NULL,
    total_matched INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alert_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_run_id INTEGER NOT NULL REFERENCES job_runs(id),
    person_name TEXT NOT NULL,
    days INTEGER NOT NULL,
    channel TEXT NOT NULL,
    role TEXT NOT NULL,
    recipient TEXT NOT NULL,
    success INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_alert_log_job_run ON alert_log(job_run_id);
`);

// --- SQLite Database Migrations ---
try {
  db.exec(`ALTER TABLE alert_log ADD COLUMN message_id TEXT;`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE alert_log ADD COLUMN delivery_status TEXT;`);
} catch (e) {
  // Column already exists, ignore
}

// The human name behind `recipient` (an email/mobile string alone doesn't
// tell a reader WHO an RM/DC actually is) — see NotificationOutcome.recipientName.
// Null for every row recorded before this column existed.
try {
  db.exec(`ALTER TABLE alert_log ADD COLUMN recipient_name TEXT;`);
} catch (e) {
  // Column already exists, ignore
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_alert_log_message_id ON alert_log(message_id);`);

export function persistDailyJobResult(result: DailyJobResult): number {
  const insertRun = db.prepare(
    `INSERT INTO job_runs (run_at, total_ingested, total_matched) VALUES (?, ?, ?)`,
  );
  const runInfo = insertRun.run(
    result.runAt,
    result.totalRecordsIngested,
    result.totalAlertsMatched,
  );
  const jobRunId = Number(runInfo.lastInsertRowid);

  const insertAlert = db.prepare(
    `INSERT INTO alert_log (job_run_id, person_name, days, channel, role, recipient, recipient_name, success, error, message_id, delivery_status)
     VALUES (@jobRunId, @personName, @days, @channel, @role, @recipient, @recipientName, @success, @error, @messageId, @deliveryStatus)`,
  );

  const insertMany = db.transaction((rows: typeof result.notifications) => {
    for (const n of rows) {
      insertAlert.run({
        jobRunId,
        personName: n.personName,
        days: n.days,
        channel: n.channel,
        role: n.role,
        recipient: n.recipient,
        recipientName: n.recipientName ?? null,
        success: n.success ? 1 : 0,
        error: n.error ?? null,
        messageId: n.messageId ?? null,
        deliveryStatus: n.deliveryStatus ?? null,
      });
    }
  });
  insertMany(result.notifications);

  return jobRunId;
}

export function getRecentJobRuns(limit = 30) {
  return db
    .prepare(`SELECT * FROM job_runs ORDER BY id DESC LIMIT ?`)
    .all(limit);
}

export function getAlertsForRun(jobRunId: number) {
  return db
    .prepare(`SELECT * FROM alert_log WHERE job_run_id = ? ORDER BY id`)
    .all(jobRunId);
}

interface AlertLogRow {
  person_name: string;
  days: number;
  channel: NotificationChannel;
  role: NotificationRole;
  recipient: string;
  success: number;
  error: string | null;
  message_id: string | null;
  delivery_status: string | null;
}

interface JobRunRow {
  id: number;
  run_at: string;
}

const EMPTY_SUMMARY: DeliverySummary = {
  jobRunId: null,
  runAt: null,
  peopleAlerted: 0,
  peopleFullyDelivered: 0,
  peoplePartiallyDelivered: 0,
  peopleFailed: 0,
  messagesTotal: 0,
  messagesSent: 0,
  messagesFailed: 0,
  byChannel: [
    { channel: "email", sent: 0, failed: 0 },
    { channel: "whatsapp", sent: 0, failed: 0 },
  ],
  people: [],
};

/**
 * Delivery report for a single run: who we messaged, what landed, what failed.
 * Defaults to the most recent run when no id is supplied.
 */
export function getDeliverySummary(jobRunId?: number): DeliverySummary {
  const run = (
    jobRunId
      ? db.prepare(`SELECT id, run_at FROM job_runs WHERE id = ?`).get(jobRunId)
      : db.prepare(`SELECT id, run_at FROM job_runs ORDER BY id DESC LIMIT 1`).get()
  ) as JobRunRow | undefined;

  if (!run) return EMPTY_SUMMARY;

  const rows = db
    .prepare(
      `SELECT person_name, days, channel, role, recipient, success, error, message_id, delivery_status
       FROM alert_log WHERE job_run_id = ? ORDER BY id`,
    )
    .all(run.id) as AlertLogRow[];

  const byPerson = new Map<string, PersonDeliveryStatus>();
  const channelTotals = new Map<NotificationChannel, { sent: number; failed: number }>([
    ["email", { sent: 0, failed: 0 }],
    ["whatsapp", { sent: 0, failed: 0 }],
  ]);

  let messagesSent = 0;
  let messagesFailed = 0;

  for (const row of rows) {
    const success = row.success === 1;
    if (success) messagesSent += 1;
    else messagesFailed += 1;

    const channel = channelTotals.get(row.channel);
    if (channel) {
      if (success) channel.sent += 1;
      else channel.failed += 1;
    }

    let person = byPerson.get(row.person_name);
    if (!person) {
      person = {
        personName: row.person_name,
        days: row.days,
        sent: 0,
        failed: 0,
        status: "failed",
        attempts: [],
      };
      byPerson.set(row.person_name, person);
    }

    if (success) person.sent += 1;
    else person.failed += 1;

    person.attempts.push({
      personName: row.person_name,
      days: row.days,
      channel: row.channel,
      role: row.role,
      recipient: row.recipient,
      success,
      error: row.error,
      messageId: row.message_id,
      deliveryStatus: row.delivery_status,
    });
  }

  const people = Array.from(byPerson.values()).map((p) => ({
    ...p,
    status: (p.failed === 0 ? "delivered" : p.sent === 0 ? "failed" : "partial") as
      PersonDeliveryStatus["status"],
  }));
  people.sort((a, b) => b.days - a.days);

  return {
    jobRunId: run.id,
    runAt: run.run_at,
    peopleAlerted: people.length,
    peopleFullyDelivered: people.filter((p) => p.status === "delivered").length,
    peoplePartiallyDelivered: people.filter((p) => p.status === "partial").length,
    peopleFailed: people.filter((p) => p.status === "failed").length,
    messagesTotal: rows.length,
    messagesSent,
    messagesFailed,
    byChannel: Array.from(channelTotals.entries()).map(([channel, t]) => ({ channel, ...t })),
    people,
  };
}

export function updateAlertDeliveryStatus(messageId: string, status: string, error?: string): boolean {
  // Check if status indicates a failure state
  const isFailed = status.toLowerCase() === "failed" || status.toLowerCase() === "undeliv";
  const success = isFailed ? 0 : 1;

  const stmt = db.prepare(`
    UPDATE alert_log
    SET delivery_status = ?,
        success = CASE WHEN ? = 0 THEN 0 ELSE success END,
        error = CASE WHEN ? = 0 AND ? IS NOT NULL THEN ? ELSE error END
    WHERE message_id = ?
  `);

  const result = stmt.run(
    status,
    success,
    success,
    error ?? null,
    error ?? null,
    messageId,
  );

  return result.changes > 0;
}

export default db;
