import db from "./alertStore.service";
import env from "../config/env";
import { InactivityRecord } from "../types";
import { getEffectiveMaxNudges } from "./adaptiveTuning.service";
import { getNumberSetting } from "./settings.service";

/**
 * Guardrails on messaging a CSP directly.
 *
 * A CSP is a person, not a ticket queue. Without these limits the agent would,
 * on the real data, have sent one CSP ~56 consecutive daily WhatsApps while her
 * terminal was dead and she was physically unable to transact. She would have
 * blocked the number, and the channel would be lost for good.
 *
 * Four rules, in priority order:
 *   1. Never nudge a CSP whose terminal is not active. They CAN'T transact —
 *      this is a technical fault, not a motivation problem. Route to support.
 *   2. Never nudge a CSP who has replied (asked for help, or asked us to stop).
 *   3. Stop after CSP_MAX_NUDGES. If three messages didn't work, a fourth won't;
 *      hand off to a human phone call.
 *   4. Never message the same CSP more often than the cooldown allows.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS csp_engagement (
    csp_code TEXT PRIMARY KEY,
    nudge_count INTEGER NOT NULL DEFAULT 0,
    last_nudged_at TEXT,
    suppressed_reason TEXT,
    suppressed_at TEXT,
    reply_text TEXT,
    updated_at TEXT NOT NULL
  );
`);

export type NudgeDecision =
  | "send"
  | "terminal-inactive"
  | "suppressed-by-reply"
  | "nudge-cap-reached"
  | "cooldown"
  | "no-mobile";

export interface CspEngagement {
  cspCode: string;
  nudgeCount: number;
  lastNudgedAt: string | null;
  suppressedReason: string | null;
  replyText: string | null;
}

interface Row {
  csp_code: string;
  nudge_count: number;
  last_nudged_at: string | null;
  suppressed_reason: string | null;
  reply_text: string | null;
}

const DAY_MS = 86_400_000;

export function loadEngagements(): Map<string, CspEngagement> {
  const rows = db
    .prepare(
      `SELECT csp_code, nudge_count, last_nudged_at, suppressed_reason, reply_text
       FROM csp_engagement`,
    )
    .all() as Row[];

  return new Map(
    rows.map((r) => [
      r.csp_code,
      {
        cspCode: r.csp_code,
        nudgeCount: r.nudge_count,
        lastNudgedAt: r.last_nudged_at,
        suppressedReason: r.suppressed_reason,
        replyText: r.reply_text,
      },
    ]),
  );
}

export function isTerminalActive(record: InactivityRecord): boolean {
  const allowed = env.CSP_ACTIVE_TERMINAL_STATUSES.split(",").map((s) =>
    s.trim().toLowerCase(),
  );
  return allowed.includes(record.terminalStatus.trim().toLowerCase());
}

export function decideNudge(
  record: InactivityRecord,
  engagement: CspEngagement | undefined,
  now: Date = new Date(),
): NudgeDecision {
  // 1. A dead terminal cannot transact. Nudging is useless AND cruel.
  if (!isTerminalActive(record)) return "terminal-inactive";

  // 2. They told us something. Respect it.
  if (engagement?.suppressedReason) return "suppressed-by-reply";

  if (!record.cspMobile) return "no-mobile";

  // 3. Messaging has demonstrably failed. Escalate to a human, not another
  //    text. The cap itself is adaptively tuned within a fixed safety range
  //    (adaptiveTuning.service.ts) — the configured cap (dashboard setting,
  //    else env.CSP_MAX_NUDGES) is only the starting point before any tuning
  //    history exists.
  if ((engagement?.nudgeCount ?? 0) >= getEffectiveMaxNudges()) return "nudge-cap-reached";

  // 4. Breathing room.
  if (engagement?.lastNudgedAt) {
    const daysSince = Math.floor(
      (now.getTime() - new Date(engagement.lastNudgedAt).getTime()) / DAY_MS,
    );
    if (daysSince < getNumberSetting("cspNudgeCooldownDays")) return "cooldown";
  }

  return "send";
}

export function recordNudgeSent(cspCode: string, now: string): void {
  db.prepare(
    `INSERT INTO csp_engagement (csp_code, nudge_count, last_nudged_at, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(csp_code) DO UPDATE SET
       nudge_count = csp_engagement.nudge_count + 1,
       last_nudged_at = ?,
       updated_at = ?`,
  ).run(cspCode, now, now, now, now);
}

/** A CSP replied. Stop nudging them and let a human take it from here. */
export function suppressFromReply(
  cspCode: string,
  reason: string,
  replyText: string,
  now: string,
): void {
  db.prepare(
    `INSERT INTO csp_engagement (csp_code, nudge_count, suppressed_reason, suppressed_at, reply_text, updated_at)
     VALUES (?, 0, ?, ?, ?, ?)
     ON CONFLICT(csp_code) DO UPDATE SET
       suppressed_reason = ?,
       suppressed_at = ?,
       reply_text = ?,
       updated_at = ?`,
  ).run(cspCode, reason, now, replyText, now, reason, now, replyText, now);
}

/** Back to active — wipe the slate so a future lapse starts fresh. */
export function resetEngagement(cspCode: string): void {
  db.prepare(`DELETE FROM csp_engagement WHERE csp_code = ?`).run(cspCode);
}

/** Nudge count as of right now — read BEFORE resetEngagement() on recovery, so the adaptive-tuning loop can learn how many nudges it actually took. */
export function getNudgeCount(cspCode: string): number {
  const row = db.prepare(`SELECT nudge_count FROM csp_engagement WHERE csp_code = ?`).get(cspCode) as
    | { nudge_count: number }
    | undefined;
  return row?.nudge_count ?? 0;
}

export function findByMobile(mobile: string): string | null {
  const row = db
    .prepare(`SELECT csp_code FROM csp_mobile_index WHERE mobile = ?`)
    .get(mobile) as { csp_code: string } | undefined;
  return row?.csp_code ?? null;
}

/** Mobile -> CSP code index, so inbound WhatsApp replies can be attributed. */
db.exec(`
  CREATE TABLE IF NOT EXISTS csp_mobile_index (
    mobile TEXT PRIMARY KEY,
    csp_code TEXT NOT NULL
  );
`);

export function indexMobiles(records: InactivityRecord[]): void {
  const stmt = db.prepare(
    `INSERT INTO csp_mobile_index (mobile, csp_code) VALUES (?, ?)
     ON CONFLICT(mobile) DO UPDATE SET csp_code = ?`,
  );
  const many = db.transaction((rs: InactivityRecord[]) => {
    for (const r of rs) {
      if (r.cspMobile && r.cspCode) stmt.run(r.cspMobile, r.cspCode, r.cspCode);
    }
  });
  many(records);
}
