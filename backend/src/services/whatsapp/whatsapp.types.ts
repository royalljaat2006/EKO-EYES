/**
 * The three values the approved Goinfinito business template actually
 * carries. When present, a provider that requires an approved template
 * (Goinfinito, and Meta if it's later given a multi-variable template) should
 * use these DIRECTLY rather than trying to recover them by pattern-matching
 * `message` — see the note on GoinfinitoWhatsAppProvider for why that used to
 * be fragile.
 */
export interface WhatsAppCspVars {
  name: string;
  cspCode: string;
  days: number;
}

export interface WhatsAppProvider {
  sendMessage(toMobile: string, message: string, cspVars?: WhatsAppCspVars): Promise<string | void>;
}

/**
 * Normalizes a mobile number to E.164-ish digits-only-with-plus form.
 * Assumes numbers are already stored with a country code in the sheet
 * (e.g. "+91XXXXXXXXXX"); if no leading "+" is present one is added.
 */
export function normalizeMobile(mobile: string): string {
  const trimmed = mobile.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/[^\d]/g, "")}`;
}
