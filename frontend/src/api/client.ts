import axios from "axios";
import type {
  CspRoster,
  DailyChanges,
  DailyJobResult,
  DeliverySummary,
  InactivityQueryResult,
  KpiReport,
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
