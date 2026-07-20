export interface Contact {
  name: string;
  email: string;
  mobile: string;
}

export interface InactivityRecord {
  cspCode: string;
  targetPersonName: string;
  cspMobile: string;
  days: number | null;
  daysRaw: string;
  rmName: string;
  dcName: string;
  rm: Contact | null;
  dc: Contact | null;
  lhoName: string;
  lhoEmail: string;
  terminalStatus: string;
  lastLoginDate: string | null;
  sourceRow: number;
}

export interface NotificationOutcome {
  channel: NotificationChannel;
  role: NotificationRole;
  recipient: string;
  personName: string;
  days: number;
  success: boolean;
  error?: string;
}

export interface DailyJobResult {
  runAt: string;
  totalRecordsIngested: number;
  totalAlertsMatched: number;
  notifications: NotificationOutcome[];
}

export interface CspRoster {
  generatedAt: string;
  total: number;
  records: InactivityRecord[];
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
  unknownRecords: number;
  summaryByRm: RmGroupSummary[];
  records: InactivityRecord[];
}

export type NotificationChannel = "email" | "whatsapp";
export type NotificationRole = "CSP" | "RM" | "DC" | "MANAGER" | "LEADERSHIP" | "SUPPORT";

export interface KpiSnapshot {
  day: string;
  totalPeople: number;
  inactiveCount: number;
  inactivityRate: number;
  atRiskCount: number;
  newBreaches: number;
  recoveries: number;
  /** Active -> inactive count for the day, at any tier. Null for rows recorded before this was tracked. */
  newlyInactive?: number | null;
}

export interface KpiReport {
  targetRate: number;
  currentRate: number;
  currentInactive: number;
  totalPeople: number;
  unknownPeople: number;
  atRisk: number;
  recoveries: number;
  newBreaches: number;
  recoveryRate: number;
  onTarget: boolean;
  trend: KpiSnapshot[];
  byTier: { tier: string; label: string; range: string; count: number }[];
  /** Daily count of CSPs in the requested bucket, oldest first. Today's point is always live. */
  rangeTrend: { day: string; count: number }[];
}
export type DeliveryStatus = "delivered" | "partial" | "failed";

export interface DeliveryAttempt {
  personName: string;
  days: number;
  channel: NotificationChannel;
  role: NotificationRole;
  recipient: string;
  success: boolean;
  error: string | null;
}

export interface PersonDeliveryStatus {
  personName: string;
  days: number;
  sent: number;
  failed: number;
  status: DeliveryStatus;
  attempts: DeliveryAttempt[];
}

export interface DeliverySummary {
  jobRunId: number | null;
  runAt: string | null;
  peopleAlerted: number;
  peopleFullyDelivered: number;
  peoplePartiallyDelivered: number;
  peopleFailed: number;
  messagesTotal: number;
  messagesSent: number;
  messagesFailed: number;
  byChannel: { channel: NotificationChannel; sent: number; failed: number }[];
  people: PersonDeliveryStatus[];
}

export interface TestChannelResult {
  attempted: boolean;
  success: boolean;
  messageId?: string | null;
  error?: string;
}

export interface TestDeliveryResult {
  ranAt: string;
  email: TestChannelResult;
  whatsapp: TestChannelResult;
}
