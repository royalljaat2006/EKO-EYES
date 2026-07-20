import crypto from "node:crypto";
import env from "../config/env";
import logger from "../utils/logger";
import { NotificationChannel, NotificationOutcome, NotificationRole } from "../types";
import { EvaluatedPerson } from "./escalation.service";
import { sendDigestEmail } from "./email.service";
import { sendDigestWhatsApp } from "./whatsapp/whatsapp.service";
import { TIERS } from "../config/escalation";
import { NudgeDecision } from "./cspEngagement.service";
import { isPlaceholderAssignee } from "../utils/placeholder";

export interface DigestTarget {
  role: NotificationRole;
  /** Display name of the recipient (RM/DC name); used to greet them on WhatsApp. */
  name: string;
  email: string;
  mobile: string;
  people: EvaluatedPerson[];
}

/** What the guardrails decided for each CSP, keyed by CSP code. */
export type NudgeDecisions = Map<string, NudgeDecision>;

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const decisionFor = (d: NudgeDecisions, p: EvaluatedPerson): NudgeDecision =>
  d.get(p.record.cspCode) ?? "send";

/** Terminal is dead — a technician's job, not a nudge. */
export const needsSupport = (d: NudgeDecisions, people: EvaluatedPerson[]) =>
  people.filter((p) => decisionFor(d, p) === "terminal-inactive");

/** Messaging has failed. A human has to pick up the phone. */
export const needsCall = (d: NudgeDecisions, people: EvaluatedPerson[]) =>
  people.filter((p) => {
    const dec = decisionFor(d, p);
    return dec === "nudge-cap-reached" || dec === "no-mobile";
  });

/**
 * Fans the evaluated people out into ONE digest per recipient.
 *
 * The CSP is only included when the guardrails say so — see cspEngagement.service.
 * Everyone else (RM, DC, manager, leadership) gets a consolidated digest.
 */
export function buildDigests(
  people: EvaluatedPerson[],
  decisions: NudgeDecisions,
): DigestTarget[] {
  const byKey = new Map<string, DigestTarget>();

  const add = (
    role: NotificationRole,
    name: string,
    email: string,
    mobile: string,
    p: EvaluatedPerson,
  ) => {
    if (!email && !mobile) return;
    const key = `${role}|${email}|${mobile}`;
    let target = byKey.get(key);
    if (!target) {
      target = { role, name, email, mobile, people: [] };
      byKey.set(key, target);
    }
    target.people.push(p);
  };

  const managerEmails = splitList(env.ESCALATION_MANAGER_EMAILS);
  const managerMobiles = splitList(env.ESCALATION_MANAGER_MOBILES);
  const leadershipEmails = splitList(env.ESCALATION_LEADERSHIP_EMAILS);
  const leadershipMobiles = splitList(env.ESCALATION_LEADERSHIP_MOBILES);
  const supportEmails = splitList(env.SUPPORT_EMAILS);
  const supportMobiles = splitList(env.SUPPORT_MOBILES);

  for (const p of people) {
    const roles = p.policy.roles;

    // The CSP is messaged directly ONLY if the guardrails allow it. A dead
    // terminal, a prior reply, a hit nudge cap or an active cooldown all mean
    // silence — see cspEngagement.service for why each one matters.
    if (roles.includes("CSP") && decisionFor(decisions, p) === "send") {
      add("CSP", p.record.targetPersonName, "", p.record.cspMobile, p);
    }

    // "TBA" is a sheet placeholder meaning no one has been assigned yet — never
    // messaged, and (below in findUnreachable) never reported as a failure.
    if (roles.includes("RM") && p.record.rm && !isPlaceholderAssignee(p.record.rmName)) {
      add("RM", p.record.rm.name || p.record.rmName, p.record.rm.email, p.record.rm.mobile, p);
    }
    if (roles.includes("DC") && p.record.dc && !isPlaceholderAssignee(p.record.dcName)) {
      add("DC", p.record.dc.name || p.record.dcName, p.record.dc.email, p.record.dc.mobile, p);
    }
    if (roles.includes("MANAGER")) {
      managerEmails.forEach((e, i) => add("MANAGER", "Manager", e, managerMobiles[i] ?? "", p));
    }
    if (roles.includes("LEADERSHIP")) {
      leadershipEmails.forEach((e, i) =>
        add("LEADERSHIP", "Leadership", e, leadershipMobiles[i] ?? "", p),
      );
    }
  }

  // Dead terminals go to support as their own digest, regardless of tier. These
  // people are not ignoring us — they are unable to comply.
  for (const p of needsSupport(decisions, people)) {
    supportEmails.forEach((e, i) => add("SUPPORT", "Support", e, supportMobiles[i] ?? "", p));
  }

  for (const t of byKey.values()) {
    t.people.sort((a, b) => (b.record.days ?? 0) - (a.record.days ?? 0));
  }
  return Array.from(byKey.values());
}

/**
 * People we were supposed to alert on but could not reach, because their RM or
 * DC has no contact on file. Logged as explicit failures so they appear in the
 * delivery dashboard instead of quietly disappearing.
 */
export function findUnreachable(people: EvaluatedPerson[]): NotificationOutcome[] {
  const out: NotificationOutcome[] = [];
  for (const p of people) {
    const roles = p.policy.roles;
    const check = (role: "RM" | "DC", name: string, contact: unknown) => {
      if (!roles.includes(role)) return;
      if (contact) return;
      // "TBA" means intentionally unassigned, not a data gap — ignore silently.
      if (isPlaceholderAssignee(name)) return;
      out.push({
        channel: "email",
        role,
        recipient: name ? `${name} (no contact on file)` : `(no ${role} assigned)`,
        personName: p.record.targetPersonName,
        days: p.record.days ?? 0,
        success: false,
        error: name
          ? `No email/mobile on file for ${role} "${name}". Add them to the contacts file.`
          : `No ${role} assigned to this CSP in the Calling Sheet.`,
      });
    };
    check("RM", p.record.rmName, p.record.rm);
    check("DC", p.record.dcName, p.record.dc);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * The CSP-facing message. Help-first, and deliberately NOT a threat.
 *
 * The earlier draft said "this will be escalated to your Relationship Manager"
 * — a threat aimed at someone who may simply be unwell, closed, or broken. It
 * also offered no way to reply. Both were wrong. This version asks whether they
 * are OK and gives them a way to answer.
 */
export function renderCspMessage(p: EvaluatedPerson): string {
  const days = p.record.days ?? 0;
  return (
    `Hello ${p.record.targetPersonName}, we noticed your CSP terminal (${p.record.cspCode}) ` +
    `has not been used for ${days} days. Is everything OK? ` +
    `If you are facing any issue — device problem, shop closed, or anything else — ` +
    `reply HELP and our team will call you. ` +
    `If all is well, a single transaction today will bring your terminal back to active.`
  );
}

export function renderDigestText(target: DigestTarget, decisions: NudgeDecisions): string {
  const lines: string[] = [
    `Inactivity digest for you as ${target.role}.`,
    `${target.people.length} CSP(s) need your attention.`,
    ``,
  ];

  if (target.role === "SUPPORT") {
    lines.push(
      `These CSPs have an INACTIVE TERMINAL. They cannot transact, so they have`,
      `NOT been sent reminders — this is a technical fault, not a follow-up task.`,
      ``,
    );
    for (const p of target.people) {
      lines.push(
        `  • ${p.record.targetPersonName} (${p.record.cspCode}) — ${p.record.days} days, ` +
          `terminal: ${p.record.terminalStatus}, RM: ${p.record.rmName || "—"}`,
      );
    }
    lines.push(``, `-- E.Y.E.S. (EKO Yield & Escalation System)`);
    return lines.join("\n");
  }

  for (const policy of TIERS) {
    const group = target.people.filter((p) => p.policy.tier === policy.tier);
    if (group.length === 0) continue;

    lines.push(`${policy.label.toUpperCase()} — ${policy.headline}`);
    for (const p of group) {
      lines.push(
        `  • ${p.record.targetPersonName} (${p.record.cspCode}) — ${p.record.days} days inactive`,
      );
    }
    lines.push(``);
  }

  // Call these out loudly: they are the ones automation cannot solve.
  const support = needsSupport(decisions, target.people);
  if (support.length > 0) {
    lines.push(
      `⚠ TERMINAL NOT ACTIVE — these CSPs physically cannot transact.`,
      `  They have NOT been messaged. They need technical support, not a reminder:`,
    );
    for (const p of support) {
      lines.push(
        `  • ${p.record.targetPersonName} (${p.record.cspCode}) — terminal: ${p.record.terminalStatus}`,
      );
    }
    lines.push(``);
  }

  const call = needsCall(decisions, target.people);
  if (call.length > 0) {
    lines.push(
      `📞 CALL REQUIRED — messaging has not worked for these CSPs.`,
      `  They have stopped receiving automated messages. Please phone them:`,
    );
    for (const p of call) {
      lines.push(`  • ${p.record.targetPersonName} (${p.record.cspCode}) — ${p.record.days} days`);
    }
    lines.push(``);
  }

  lines.push(
    `Target: keep inactivity at or below ${env.TARGET_INACTIVITY_RATE}%.`,
    ``,
    `-- E.Y.E.S. (EKO Yield & Escalation System)`,
  );
  return lines.join("\n");
}

/**
 * WhatsApp goes out through an APPROVED, single-CSP template (3 variables:
 * name, CSP code, days). A recipient's WhatsApp therefore cannot carry an
 * aggregate "N CSPs need action" summary — that shape does not fit the template
 * and Meta silently drops it. So each RM/DC gets ONE template message PER CSP
 * they are responsible for, greeting them by name. The full list still goes out
 * as their single email digest. This text MUST match the provider's template
 * regex in goinfinitoWhatsApp.provider.ts.
 */
export function renderRoleCspWhatsApp(recipientName: string, p: EvaluatedPerson): string {
  const days = p.record.days ?? 0;
  const who = recipientName.trim() || "there";
  return (
    `Hello ${who}, we noticed your CSP terminal (${p.record.cspCode}) ` +
    `has not been used for ${days} days.`
  );
}

/**
 * The WhatsApp message(s) for a recipient. CSPs get one direct nudge; everyone
 * else gets one template-conforming message per CSP (see renderRoleCspWhatsApp).
 */
export function buildWhatsAppMessages(
  target: DigestTarget,
): { text: string; person: EvaluatedPerson }[] {
  if (target.role === "CSP") {
    return [{ text: renderCspMessage(target.people[0]), person: target.people[0] }];
  }
  return target.people.map((p) => ({
    text: renderRoleCspWhatsApp(target.name, p),
    person: p,
  }));
}

function channelsFor(target: DigestTarget): NotificationChannel[] {
  if (target.role === "CSP") return ["whatsapp"]; // no CSP email exists in the sheet
  if (target.role === "SUPPORT") return ["email"];
  const set = new Set<NotificationChannel>();
  for (const p of target.people) p.policy.channels.forEach((c) => set.add(c));
  return Array.from(set);
}

export async function sendDigests(
  targets: DigestTarget[],
  decisions: NudgeDecisions,
): Promise<NotificationOutcome[]> {
  const outcomes: NotificationOutcome[] = [];

  for (const target of targets) {
    const channels = channelsFor(target);
    const names = target.people.map((p) => ({
      personName: p.record.targetPersonName,
      days: p.record.days ?? 0,
    }));

    const emailTo = target.email;
    const mobileTo = target.mobile;

    if (channels.includes("email") && emailTo) {
      const emailMessageId = crypto.randomUUID();
      try {
        await sendDigestEmail(emailTo, target.role, renderDigestText(target, decisions), emailMessageId);
        names.forEach((n) =>
          outcomes.push({
            channel: "email",
            role: target.role,
            recipient: emailTo,
            ...n,
            success: true,
            messageId: emailMessageId,
            deliveryStatus: "sent",
          }),
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ err, role: target.role }, "Digest email failed");
        names.forEach((n) =>
          outcomes.push({
            channel: "email",
            role: target.role,
            recipient: emailTo,
            ...n,
            success: false,
            error,
            messageId: emailMessageId,
            deliveryStatus: "failed",
          }),
        );
      }
    }

    if (channels.includes("whatsapp") && mobileTo) {
      // One WhatsApp per CSP for RM/DC (the approved template is single-CSP);
      // exactly one for a CSP recipient. Each message is recorded on its own so
      // a single CSP failing does not mask the others.
      for (const wa of buildWhatsAppMessages(target)) {
        const person = {
          personName: wa.person.record.targetPersonName,
          days: wa.person.record.days ?? 0,
        };
        try {
          const messageId = await sendDigestWhatsApp(mobileTo, wa.text);
          outcomes.push({
            channel: "whatsapp",
            role: target.role,
            recipient: mobileTo,
            ...person,
            success: true,
            messageId: typeof messageId === "string" ? messageId : null,
            deliveryStatus: typeof messageId === "string" ? "submitted" : "sent",
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          logger.error({ err, role: target.role }, "Digest WhatsApp failed");
          outcomes.push({
            channel: "whatsapp",
            role: target.role,
            recipient: mobileTo,
            ...person,
            success: false,
            error,
            deliveryStatus: "failed",
          });
        }
      }
    }
  }

  return outcomes;
}
