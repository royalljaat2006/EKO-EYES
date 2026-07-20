import env from "../src/config/env";
import logger from "../src/utils/logger";
import { sendDigestEmail, verifyEmailTransport } from "../src/services/email.service";

/**
 * One-shot email connectivity test.
 *
 * Usage:  npm run test:email -- you@example.com
 * (falls back to SMTP_USER / GMAIL_USER_EMAIL if no recipient is given)
 *
 * It (1) verifies the transport can authenticate, then (2) sends a real sample
 * digest so you can confirm end-to-end delivery before wiring up the daily job.
 */
async function main() {
  const recipient =
    process.argv[2] || env.SMTP_USER || env.GMAIL_USER_EMAIL || "";

  if (!recipient) {
    throw new Error("No recipient given and no SMTP_USER/GMAIL_USER_EMAIL to fall back to.");
  }

  logger.info({ provider: env.EMAIL_PROVIDER, from: env.ALERT_EMAIL_FROM }, "Verifying transport…");
  await verifyEmailTransport();
  logger.info("Transport verified ✔  — credentials accepted.");

  const body = [
    "This is a TEST email from the Inactivity Alert Agent.",
    "",
    "If you are reading this, Gmail email delivery is working end to end.",
    "",
    "Sample of what an RM digest looks like:",
    "",
    "RM FOLLOW-UP — Inactive over 7 days — RM follow-up required",
    "  • Kavita Kumari (1A852478) — 12 days inactive",
    "  • Vikas Gupta (1A852523) — 9 days inactive",
    "",
    "-- Automated Inactivity Alert Agent",
  ].join("\n");

  logger.info({ recipient }, "Sending test email…");
  await sendDigestEmail(recipient, "RM", body);
  logger.info({ recipient }, "Test email sent ✔  — check the inbox (and spam).");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, "Email test FAILED");
  process.exit(1);
});
