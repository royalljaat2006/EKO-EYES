import env from "../../config/env";
import { InactivityRecord, NotificationRole } from "../../types";
import { MetaWhatsAppProvider } from "./metaWhatsApp.provider";
import { TwilioWhatsAppProvider } from "./twilioWhatsApp.provider";
import { GoinfinitoWhatsAppProvider } from "./goinfinitoWhatsApp.provider";
import { WhatsAppCspVars, WhatsAppProvider } from "./whatsapp.types";

let provider: WhatsAppProvider | null = null;

function getProvider(): WhatsAppProvider {
  if (!provider) {
    if (env.WHATSAPP_PROVIDER === "twilio") {
      provider = new TwilioWhatsAppProvider();
    } else if (env.WHATSAPP_PROVIDER === "goinfinito") {
      provider = new GoinfinitoWhatsAppProvider();
    } else {
      provider = new MetaWhatsAppProvider();
    }
  }
  return provider;
}

export function buildWhatsAppAlertText(record: InactivityRecord, role: NotificationRole): string {
  return (
    `Inactivity Alert: ${record.targetPersonName} has been inactive for ${record.days} days. ` +
    `You are being notified as the ${role}. Please follow up as soon as possible.`
  );
}

/**
 * One consolidated WhatsApp digest to a single recipient. `cspVars` should be
 * passed whenever the message concerns one specific CSP (every real tier
 * message does) — see WhatsAppCspVars for why: it lets an approved-template
 * provider fill its variables directly instead of parsing them back out of
 * `message`, so editing the message wording can never break delivery.
 */
export async function sendDigestWhatsApp(
  mobile: string,
  message: string,
  cspVars?: WhatsAppCspVars,
): Promise<string | void> {
  if (!mobile) throw new Error("Missing mobile number for WhatsApp digest");
  return await getProvider().sendMessage(mobile, message, cspVars);
}

export async function sendAlertWhatsApp(
  record: InactivityRecord,
  role: NotificationRole,
  mobile: string,
): Promise<string | void> {
  if (!mobile) {
    throw new Error(`Missing ${role} mobile number for ${record.targetPersonName}`);
  }
  const message = buildWhatsAppAlertText(record, role);
  return await getProvider().sendMessage(mobile, message);
}
