import axios from "axios";
import type {
  AppSettings,
  AtRiskEntry,
  CspRoster,
  DailyChanges,
  DailyJobResult,
  DailySummary,
  DeliverySummary,
  EffectiveTemplate,
  GeoBreakdown,
  InactivityQueryResult,
  InactivityRecord,
  KpiReport,
  MessageReach,
  OneOffNudgeResult,
  Recommendation,
  RmDcPerformance,
  TestDeliveryResult,
  TuningReport,
} from "../types";
import type { RangeFilter } from "../rangeOptions";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

const client = axios.create({ baseURL: API_BASE_URL, timeout: 15_000 });

export async function fetchInactivityData(range: RangeFilter): Promise<InactivityQueryResult> {
  const { data } = await client.get<InactivityQueryResult>("/inactivity", {
    params: { range },
  });
  return data;
}

export async function fetchDeliverySummary(): Promise<DeliverySummary> {
  const { data } = await client.get<DeliverySummary>("/delivery-summary");
  return data;
}

/** The full roster — every CSP, not just those over the threshold. */
export async function fetchAllCsps(): Promise<CspRoster> {
  const { data } = await client.get<CspRoster>("/csps");
  return data;
}

export async function fetchKpiReport(range: RangeFilter): Promise<KpiReport> {
  const { data } = await client.get<KpiReport>("/kpi", { params: { range } });
  return data;
}

/** The named audit trail: who specifically went active -> inactive today, and who recovered. Defaults to today. */
export async function fetchDailyChanges(day?: string): Promise<DailyChanges> {
  const { data } = await client.get<DailyChanges>("/daily-changes", { params: day ? { day } : {} });
  return data;
}

/** The adaptive nudge-cap's current value, bounds, and its full audited evaluation history. */
export async function fetchAdaptiveTuning(): Promise<TuningReport> {
  const { data } = await client.get<TuningReport>("/adaptive-tuning");
  return data;
}

/** Currently-inactive CSPs decideNudge would refuse to message again — nudge cap exhausted, or they asked us to stop. */
export async function fetchNonResponsive(): Promise<InactivityRecord[]> {
  const { data } = await client.get<{ records: InactivityRecord[] }>("/non-responsive");
  return data.records;
}

/** State- and district-wise inactivity breakdown, ranked by rate — the heat map data. */
export async function fetchGeoBreakdown(): Promise<GeoBreakdown> {
  const { data } = await client.get<GeoBreakdown>("/geo-breakdown");
  return data;
}

/** Per-RM and per-DC recovery performance over the trailing 30 days. */
export async function fetchRmDcPerformance(): Promise<RmDcPerformance> {
  const { data } = await client.get<RmDcPerformance>("/rm-dc-performance");
  return data;
}

/** A plain-English daily readout, template-assembled from real numbers — not an LLM call. */
export async function fetchDailySummary(): Promise<DailySummary> {
  const { data } = await client.get<DailySummary>("/insights/summary");
  return data;
}

/** Rule-based next-action suggestion per currently-inactive CSP (visit vs. keep calling). */
export async function fetchRecommendations(): Promise<Recommendation[]> {
  const { data } = await client.get<{ recommendations: Recommendation[] }>("/insights/recommendations");
  return data.recommendations;
}

/** Early warning for currently-healthy CSPs trending toward the 3-day threshold or with a relapse history. */
export async function fetchAtRisk(): Promise<AtRiskEntry[]> {
  const { data } = await client.get<{ atRisk: AtRiskEntry[] }>("/insights/at-risk");
  return data.atRisk;
}

/** The effective runtime configuration: saved dashboard overrides layered on the server's .env defaults. */
export async function fetchSettings(): Promise<AppSettings> {
  const { data } = await client.get<AppSettings>("/settings");
  return data;
}

/**
 * Saves configuration overrides and returns the full effective settings as
 * the server now sees them. Only the keys you pass are written — omitted
 * ones keep their current value rather than resetting.
 */
export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const { data } = await client.post<AppSettings>("/settings", settings);
  return data;
}

/** Every outbound message template with its current effective text and edit metadata. */
export async function fetchTemplates(): Promise<EffectiveTemplate[]> {
  const { data } = await client.get<{ templates: EffectiveTemplate[] }>("/templates");
  return data.templates;
}

/** Saves one or more templates by key. Throws (with a specific message) if a save would drop a required placeholder. */
export async function updateTemplates(patch: Record<string, string>): Promise<EffectiveTemplate[]> {
  const { data } = await client.post<{ templates: EffectiveTemplate[] }>("/templates", patch);
  return data.templates;
}

/** Reverts one template to its built-in default. */
export async function resetTemplate(key: string): Promise<EffectiveTemplate[]> {
  const { data } = await client.post<{ templates: EffectiveTemplate[] }>(
    `/templates/${encodeURIComponent(key)}/reset`,
  );
  return data.templates;
}

/** How many CSPs were messaged and how many distinct RMs/DCs were reached on a run, with full per-recipient drill-down. Defaults to the most recent run. */
export async function fetchMessageReach(): Promise<MessageReach> {
  const { data } = await client.get<MessageReach>("/message-reach");
  return data;
}

/**
 * A deliberate, human-initiated single-CSP nudge — sends a REAL WhatsApp
 * message to this one CSP right now, bypassing the normal cooldown/cap
 * (never the terminal-active/suppressed-by-reply safety rules). The caller
 * MUST gate this behind its own confirm step — this function does not.
 * The backend returns 400 (not 200) for a refused nudge (dead terminal,
 * asked to stop, etc.), which axios treats as an error — unwrap it back
 * into a normal result so the caller always gets {success, error}.
 */
export async function triggerOneOffNudge(cspCode: string): Promise<OneOffNudgeResult> {
  try {
    const { data } = await client.post<OneOffNudgeResult>(`/csps/${encodeURIComponent(cspCode)}/nudge`);
    return data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data) {
      return err.response.data as OneOffNudgeResult;
    }
    return { success: false, cspCode, personName: "", error: "Request failed. Confirm the API server is running." };
  }
}

/**
 * Manually triggers the full ingest -> evaluate -> notify pipeline right now,
 * instead of waiting for the daily schedule. This sends REAL messages to
 * whoever is due today, so the UI must confirm before calling this.
 * Given a large roster, a real run can take a while — longer timeout than the
 * default client.
 */
export async function triggerDailyJob(): Promise<DailyJobResult> {
  const { data } = await client.post<DailyJobResult>("/job-runs/trigger", null, {
    timeout: 120_000,
  });
  return data;
}

/**
 * Sends a one-off test message to a chosen contact and reports whether each
 * channel (email / WhatsApp) delivered. This is a diagnostic only — it does not
 * touch the spreadsheet or message any real CSP/RM/DC.
 */
export async function runTestDelivery(
  email: string,
  mobile: string,
): Promise<TestDeliveryResult> {
  const { data } = await client.post<TestDeliveryResult>(
    "/test-delivery",
    { email, mobile },
    { timeout: 60_000 },
  );
  return data;
}

export default client;
