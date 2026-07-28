import db from "./alertStore.service";
import { NotificationChannel, NotificationRole } from "../types";

/**
 * "How many CSPs did we message, and how many RMs/DCs did we actually
 * reach" — a different cut of `alert_log` than getDeliverySummary (which
 * groups by CSP only). Read-only aggregation, no new writes.
 *
 * The distinction that matters: a CSP's own row IS one CSP (role=CSP,
 * one direct WhatsApp). An RM/DC's rows are NOT one-per-RM — the digest
 * fans out to one row PER CSP they cover (email digest line + one WhatsApp
 * per CSP, since the approved template is single-CSP — see
 * digest.service.ts). So "RMs reached" has to be counted by DISTINCT
 * recipient contact, not by row count, or one RM covering 12 CSPs would
 * look like 12 different RMs.
 */

interface Row {
  person_name: string;
  days: number;
  channel: NotificationChannel;
  role: NotificationRole;
  recipient: string;
  recipient_name: string | null;
  success: number;
}

export interface ReachedCspAttempt {
  personName: string;
  days: number;
  channel: NotificationChannel;
  success: boolean;
}

export interface ReachedRecipient {
  /** Email or mobile — the stable identity key (alert_log has no separate RM/DC id). */
  contact: string;
  /** The RM/DC's own name, when we have one — see NotificationOutcome.recipientName. */
  name: string | null;
  /** Distinct CSPs where at least one message to this recipient about them succeeded. */
  cspsCovered: number;
  /** Distinct CSPs attempted, succeeded or not. */
  cspsAttempted: number;
  sent: number;
  failed: number;
  csps: ReachedCspAttempt[];
}

export interface RoleReach {
  /** Distinct recipients with at least one successful message. */
  reached: number;
  /** Distinct recipients attempted at all, whether reached or not. */
  attempted: number;
  entries: ReachedRecipient[];
}

export interface MessageReach {
  jobRunId: number | null;
  runAt: string | null;
  csp: {
    reached: number;
    attempted: number;
    people: ReachedCspAttempt[];
  };
  rm: RoleReach;
  dc: RoleReach;
}

const EMPTY_ROLE: RoleReach = { reached: 0, attempted: 0, entries: [] };
const EMPTY: MessageReach = {
  jobRunId: null,
  runAt: null,
  csp: { reached: 0, attempted: 0, people: [] },
  rm: EMPTY_ROLE,
  dc: EMPTY_ROLE,
};

function buildRoleReach(rows: Row[], role: "RM" | "DC"): RoleReach {
  const byContact = new Map<string, ReachedRecipient>();
  for (const r of rows) {
    if (r.role !== role) continue;
    let entry = byContact.get(r.recipient);
    if (!entry) {
      entry = { contact: r.recipient, name: r.recipient_name, cspsCovered: 0, cspsAttempted: 0, sent: 0, failed: 0, csps: [] };
      byContact.set(r.recipient, entry);
    }
    entry.csps.push({ personName: r.person_name, days: r.days, channel: r.channel, success: r.success === 1 });
    if (r.success === 1) entry.sent += 1;
    else entry.failed += 1;
  }

  for (const entry of byContact.values()) {
    entry.cspsAttempted = new Set(entry.csps.map((c) => c.personName)).size;
    entry.cspsCovered = new Set(entry.csps.filter((c) => c.success).map((c) => c.personName)).size;
  }

  const entries = Array.from(byContact.values()).sort((a, b) => b.cspsCovered - a.cspsCovered);
  return {
    reached: entries.filter((e) => e.sent > 0).length,
    attempted: entries.length,
    entries,
  };
}

/** Defaults to the most recent run when no id is supplied — same convention as getDeliverySummary. */
export function getMessageReach(jobRunId?: number): MessageReach {
  const run = (
    jobRunId
      ? db.prepare(`SELECT id, run_at FROM job_runs WHERE id = ?`).get(jobRunId)
      : db.prepare(`SELECT id, run_at FROM job_runs ORDER BY id DESC LIMIT 1`).get()
  ) as { id: number; run_at: string } | undefined;

  if (!run) return EMPTY;

  const rows = db
    .prepare(
      `SELECT person_name, days, channel, role, recipient, recipient_name, success
       FROM alert_log WHERE job_run_id = ? ORDER BY id`,
    )
    .all(run.id) as Row[];

  const cspRows = rows.filter((r) => r.role === "CSP");
  const cspPeople: ReachedCspAttempt[] = cspRows.map((r) => ({
    personName: r.person_name,
    days: r.days,
    channel: r.channel,
    success: r.success === 1,
  }));

  return {
    jobRunId: run.id,
    runAt: run.run_at,
    csp: {
      reached: new Set(cspRows.filter((r) => r.success === 1).map((r) => r.person_name)).size,
      attempted: new Set(cspRows.map((r) => r.person_name)).size,
      people: cspPeople.sort((a, b) => b.days - a.days),
    },
    rm: buildRoleReach(rows, "RM"),
    dc: buildRoleReach(rows, "DC"),
  };
}
