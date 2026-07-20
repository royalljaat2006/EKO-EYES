export interface WhatsAppProvider {
  sendMessage(toMobile: string, message: string): Promise<string | void>;
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
