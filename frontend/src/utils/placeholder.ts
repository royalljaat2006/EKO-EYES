/**
 * Sentinel assignee names in the Calling Sheet meaning "not actually assigned
 * yet" — e.g. one DC is literally named "TBA". Mirrors
 * backend/src/utils/placeholder.ts so the dashboard doesn't flag these as a
 * contact-data problem when the backend already treats them as intentional.
 */
const PLACEHOLDER_NAMES = new Set(["tba"]);

export function isPlaceholderAssignee(name: string): boolean {
  return PLACEHOLDER_NAMES.has(name.trim().toLowerCase());
}
