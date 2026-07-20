/**
 * The inactivity-day buckets used across the dashboard (the main filter and
 * the All CSPs table). Each bucket is [min, max): min inclusive, max
 * exclusive, so the shared boundaries (7, 15, 30, 60, 90) never double-count
 * a CSP. "90+" is open-ended.
 */
export const RANGE_OPTIONS = ["3-7", "7-15", "15-30", "30-60", "60-90", "90+"] as const;

export type RangeOption = (typeof RANGE_OPTIONS)[number];

export const RANGE_BOUNDS: Record<RangeOption, [number, number | null]> = {
  "3-7": [3, 7],
  "7-15": [7, 15],
  "15-30": [15, 30],
  "30-60": [30, 60],
  "60-90": [60, 90],
  "90+": [90, null],
};

export function isRangeOption(value: unknown): value is RangeOption {
  return typeof value === "string" && (RANGE_OPTIONS as readonly string[]).includes(value);
}

export function inRange(days: number, range: RangeOption): boolean {
  const [min, max] = RANGE_BOUNDS[range];
  return days >= min && (max === null || days < max);
}

export const RANGE_LABELS: Record<RangeOption, string> = {
  "3-7": "3–7 Days",
  "7-15": "7–15 Days",
  "15-30": "15–30 Days",
  "30-60": "30–60 Days",
  "60-90": "60–90 Days",
  "90+": "90+ Days",
};

/**
 * "All Days" — the union of every bucket above, i.e. every flagged CSP (day 3+)
 * in one view instead of clicking through each bucket. Lets the dashboard's top
 * filter and /api/inactivity, /api/kpi show the combined set in a single click.
 */
export const ALL_RANGES = "all" as const;
export type RangeFilter = RangeOption | typeof ALL_RANGES;

export const RANGE_FILTER_OPTIONS = [ALL_RANGES, ...RANGE_OPTIONS] as const;

export const RANGE_FILTER_LABELS: Record<RangeFilter, string> = {
  all: "All Days",
  ...RANGE_LABELS,
};

export function isRangeFilter(value: unknown): value is RangeFilter {
  return value === ALL_RANGES || isRangeOption(value);
}

export function inRangeFilter(days: number, filter: RangeFilter): boolean {
  if (filter === ALL_RANGES) return RANGE_OPTIONS.some((opt) => inRange(days, opt));
  return inRange(days, filter);
}
