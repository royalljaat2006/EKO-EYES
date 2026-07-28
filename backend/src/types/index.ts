export interface Contact {
  name: string;
  email: string;
  mobile: string;
}

export interface InactivityRecord {
  /** CSP Code — the stable unique key for a person. */
  cspCode: string;
  /** CSP Name. Kept as `targetPersonName` in the API for dashboard continuity. */
  targetPersonName: string;
  cspMobile: string;

  /**
   * Inactivity days. NULL means the source said "No transaction data" — which
   * is NOT the same as zero. Conflating the two would flatter the inactivity
   * rate, so unknowns are carried through and surfaced separately.
   */
  days: number | null;
  /** The raw cell value, kept so unparseable rows can be audited. */
  daysRaw: string;

  rmName: string;
  dcName: string;
  /** Resolved from the contacts mapping; null when we have no way to reach them. */
  rm: Contact | null;
  dc: Contact | null;

  /** "Circle (LHO)" in the sheet — a level above RM/DC, browse-only (not alerted). */
  lhoName: string;
  lhoEmail: string;

  /** Geography, browse-only (not alerted) — feeds the state/district heat map. */
  state: string;
  district: string;

  terminalStatus: string;
  lastLoginDate: string | null;

  /** 1-based row number in the source sheet, used for traceability in logs */
  sourceRow: number;
}

export interface RmGroupSummary {
  rmName: string;
  count: number;
}

export interface InactivityQueryResult {
  /** The selected inactivity-day bucket, e.g. "7-15" or "90+". */
  range: string;
  generatedAt: string;
  totalRecords: number;
  /** Rows whose inactivity is unknown ("No transaction data") — surfaced, never hidden. */
  unknownRecords: number;
  summaryByRm: RmGroupSummary[];
  records: InactivityRecord[];
}

export type NotificationChannel = "email" | "whatsapp";
export type NotificationRole = "CSP" | "RM" | "DC" | "MANAGER" | "LEADERSHIP" | "SUPPORT";

export interface NotificationOutcome {
  channel: NotificationChannel;
  role: NotificationRole;
  recipient: string;
  /** The human name behind `recipient` (the RM/DC/CSP's own name) — `recipient` alone is only an email/mobile, not something a person recognizes. Null when there's no name to attach (e.g. a bare Manager/Leadership/Support email list entry). */
  recipientName?: string | null;
  personName: string;
  days: number;
  success: boolean;
  error?: string;
  messageId?: string | null;
  deliveryStatus?: string | null;
}

export interface DailyJobResult {
  runAt: string;
  totalRecordsIngested: number;
  totalAlertsMatched: number;
  notifications: NotificationOutcome[];
}

/** A daily measurement of the thing we actually care about: the inactivity rate. */
export interface KpiSnapshot {
  /** YYYY-MM-DD */
  day: string;
  totalPeople: number;
  inactiveCount: number;
  /** inactiveCount / totalPeople, as a percentage (0-100) */
  inactivityRate: number;
  atRiskCount: number;
  /** CSPs escalated past the self-nudge stage for the first time today (excludes day-3 entrants). */
  newBreaches: number;
  /** CSPs that dropped out of every tier today — the "recovered" side of the daily-change chart. */
  recoveries: number;
  /**
   * CSPs that went from active (untracked) to flagged for the first time today,
   * at ANY tier including the day-3 self-nudge floor — the "newly inactive"
   * side of the daily-change chart, i.e. active -> inactive. Null for rows
   * recorded before this was tracked (not the same as zero).
   */
  newlyInactive?: number | null;
  /** CSP count per inactivity-day bucket that day, e.g. {"7-15": 12}. Absent for rows recorded before this was tracked. */
  rangeCounts?: Partial<Record<string, number>> | null;
}

export interface KpiReport {
  targetRate: number;
  currentRate: number;
  currentInactive: number;
  /** Denominator of the rate: rows with a known inactivity value. */
  totalPeople: number;
  /** Rows we could not measure ("No transaction data"). */
  unknownPeople: number;
  atRisk: number;
  /**
   * Currently-inactive CSPs who've exhausted their nudge cap or explicitly
   * asked us to stop, and haven't recovered since — reuses decideNudge's own
   * "nudge-cap-reached"/"suppressed-by-reply" outcomes, not a new heuristic.
   */
  nonResponsive: number;
  /** People who returned to active in the trailing window */
  recoveries: number;
  newBreaches: number;
  /** Share of alerted people who recovered, as a percentage */
  recoveryRate: number;
  onTarget: boolean;
  trend: KpiSnapshot[];
  byTier: { tier: string; label: string; count: number }[];
  /** Daily count of CSPs in the requested bucket (query's `range`), oldest first. Today's point is always live. */
  rangeTrend: { day: string; count: number }[];
}

/** One message actually dispatched (or attempted) during a run. */
export interface DeliveryAttempt {
  personName: string;
  days: number;
  channel: NotificationChannel;
  role: NotificationRole;
  recipient: string;
  recipientName?: string | null;
  success: boolean;
  error: string | null;
  messageId?: string | null;
  deliveryStatus?: string | null;
}

/** Per-person rollup: did every message for this person land? */
export interface PersonDeliveryStatus {
  personName: string;
  days: number;
  sent: number;
  failed: number;
  /** delivered = all messages landed, partial = some landed, failed = none landed */
  status: "delivered" | "partial" | "failed";
  attempts: DeliveryAttempt[];
}

export interface DeliverySummary {
  jobRunId: number | null;
  runAt: string | null;
  /** People that matched the >7 day rule, i.e. people we tried to alert about */
  peopleAlerted: number;
  peopleFullyDelivered: number;
  peoplePartiallyDelivered: number;
  peopleFailed: number;
  /** Individual messages (2 recipients x 2 channels per person) */
  messagesTotal: number;
  messagesSent: number;
  messagesFailed: number;
  byChannel: {
    channel: NotificationChannel;
    sent: number;
    failed: number;
  }[];
  people: PersonDeliveryStatus[];
}
