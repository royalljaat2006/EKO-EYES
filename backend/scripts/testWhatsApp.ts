import env from "../src/config/env";
import logger from "../src/utils/logger";
import { sendDigestWhatsApp } from "../src/services/whatsapp/whatsapp.service";

/**
 * One-shot WhatsApp connectivity test.
 *
 * Usage:  npm run test:whatsapp -- +9198XXXXXXXX
 *
 * Sends a single test message through whichever provider WHATSAPP_PROVIDER
 * points at (meta | twilio | goinfinito). NOTE: business-initiated WhatsApp
 * messages require an APPROVED TEMPLATE — if the template isn't approved yet,
 * the provider will reject the send and this will report the exact error.
 */
async function main() {
  const to = process.argv[2];
  if (!to) {
    throw new Error("Provide a recipient mobile, e.g. npm run test:whatsapp -- +9198XXXXXXXX");
  }

  const message =
    "This is a TEST message from the Inactivity Alert Agent. " +
    "If you received this, WhatsApp delivery is working end to end.";

  logger.info({ provider: env.WHATSAPP_PROVIDER, to }, "Sending test WhatsApp message…");
  const result = await sendDigestWhatsApp(to, message);
  logger.info(
    { to, messageId: result || "(no id returned)" },
    "WhatsApp send accepted ✔ — check the phone. Delivery receipt (if enabled) will follow via the DLR webhook.",
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error(
    { err: err instanceof Error ? err.message : err },
    "WhatsApp test FAILED — see the error above (common causes: unapproved template, wrong sender number, bad API key).",
  );
  process.exit(1);
});
