export interface Contact {
  name: string;
  email: string;
  mobile: string;
}

export interface OneOffNudgeResult {
  success: boolean;
  cspCode: string;
  personName: string;
  error?: string;
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
  state: string;
  district: string;
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
  nonResponsive: number;
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

export interface InactivityOnsetEntry {
  personName: string;
  cspCode: string;
  tier: string | null;
  days: number;
  onsetAt: string;
  /** Their day-count in yesterday's snapshot, so the UI can show "was 2d → now 4d". Null when unknown or for a new CSP. */
  previousDays: number | null;
}

export interface RecoveryEntry {
  personName: string;
  tierAtRecovery: string | null;
  daysFlagged: number | null;
  recoveredAt: string;
}

export interface DailyChanges {
  day: string;
  /** Real transitions only: healthy yesterday, flagged today. */
  newlyInactive: InactivityOnsetEntry[];
  /** Appeared in the sheet already flagged — a roster addition, deliberately NOT counted as a transition. */
  newCspsAdded: InactivityOnsetEntry[];
  recovered: RecoveryEntry[];
}

export interface GeoBucket {
  key: string;
  label: string;
  total: number;
  inactive: number;
  rate: number;
}

export interface GeoBreakdown {
  states: GeoBucket[];
  districts: GeoBucket[];
}

export interface PerformanceEntry {
  key: string;
  label: string;
  currentlyInactive: number;
  recovered: number;
  avgRecoveryDays: number | null;
  efficiency: number;
}

export interface RmDcPerformance {
  rm: PerformanceEntry[];
  dc: PerformanceEntry[];
}

export interface DailySummary {
  text: string;
  stats: {
    totalInactive: number;
    newlyInactiveToday: number;
    crossed3: number;
    crossed7: number;
    crossed30: number;
    nonResponsive: number;
    worstDistrict: { label: string; rate: number } | null;
  };
}

export type RecommendationCategory = "visit" | "call";

export interface Recommendation {
  cspCode: string;
  personName: string;
  days: number | null;
  rmName: string;
  category: RecommendationCategory;
  reason: string;
}

export interface AtRiskEntry {
  cspCode: string;
  personName: string;
  days: number | null;
  rmName: string;
  reason: string;
}

export interface TuningEvaluation {
  id: number;
  param: string;
  oldValue: number;
  newValue: number;
  sampleSize: number;
  nearCapShare: number | null;
  earlyShare: number | null;
  reason: string;
  evaluatedAt: string;
}

export interface TuningReport {
  param: string;
  currentValue: number;
  bounds: [number, number];
  defaultValue: number;
  history: TuningEvaluation[];
}

/**
 * Runtime configuration an operator can change from the dashboard. Mirrors
 * the backend's AppSettings (settings.service.ts) — every field is always
 * present in a GET response; a PATCH-style save may send any subset.
 */
export interface AppSettings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  inactivityThresholdDays: number;
  targetInactivityRate: number;
  cspMaxNudges: number;
  cspNudgeCooldownDays: number;
}

export type TemplateChannel = "email" | "whatsapp";

/**
 * Mirrors the backend's EffectiveTemplate (templates.service.ts). `approvalLocked`
 * is true only for WhatsApp templates — the wording here does not reach the
 * recipient as typed on the Goinfinito/Meta approved-template channel; only
 * the placeholder VALUES do. The frontend must show this caveat, never hide it.
 */
export interface EffectiveTemplate {
  key: string;
  label: string;
  description: string;
  channel: TemplateChannel;
  requiredPlaceholders: string[];
  sampleVars: Record<string, string>;
  approvalLocked?: boolean;
  defaultValue: string;
  value: string;
  isCustomized: boolean;
}

export interface ReachedCspAttempt {
  personName: string;
  days: number;
  channel: "email" | "whatsapp";
  success: boolean;
}

export interface ReachedRecipient {
  contact: string;
  name: string | null;
  cspsCovered: number;
  cspsAttempted: number;
  sent: number;
  failed: number;
  csps: ReachedCspAttempt[];
}

export interface RoleReach {
  reached: number;
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
