/**
 * Sentinel assignee names found in the Calling Sheet that mean "not actually
 * assigned yet" — e.g. one DC is literally named "TBA". These are never
 * messaged and never reported as a contact failure; they are silently
 * skipped, same as if that role simply weren't in the tier's roles list.
 */
const PLACEHOLDER_NAMES = new Set(["tba"]);

export function isPlaceholderAssignee(name: string): boolean {
  return PLACEHOLDER_NAMES.has(name.trim().toLowerCase());
}
