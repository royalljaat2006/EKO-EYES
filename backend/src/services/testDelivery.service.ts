import crypto from "node:crypto";
import logger from "../utils/logger";
import { sendDigestEmail, verifyEmailTransport } from "./email.service";
import { sendDigestWhatsApp } from "./whatsapp/whatsapp.service";

/** Outcome of one channel in a test-delivery run. */
export interface TestChannelResult {
  attempted: boolean;
  success: boolean;
  messageId?: string | null;
  error?: string;
}

export interface TestDeliveryResult {
  ranAt: string;
  email: TestChannelResult;
  whatsapp: TestChannelResult;
}

const TEST_EMAIL_BODY = [
  "This is a TEST message from E.Y.E.S. (EKO Yield & Escalation System).",
  "",
  "If you are reading this, email delivery is working end to end.",
  "It does NOT affect any CSP, RM, or DC, and the spreadsheet was not touched.",
  "",
  "-- E.Y.E.S. (delivery test)",
].join("\n");

// WhatsApp here goes out through Goinfinito's APPROVED template (CERF_TEMPLATE_ID),
// which has 3 variables and is matched by a regex on this exact sentence shape:
//   "Hello {{1}}, we noticed your CSP terminal ({{2}}) has not been used for {{3}} days"
// A message that does NOT match that shape falls back to empty {{2}}/{{3}}, which
// Goinfinito accepts (returns a GUID) but Meta silently drops. So the test body
// MUST match the template, with clearly-fake values, or the test won't deliver.
const TEST_WHATSAPP_BODY =
  "Hello Delivery Test, we noticed your CSP terminal (TEST-CSP) has not been used for 1 days.";

/**
 * Sends a one-off test message on each requested channel and reports whether it
 * landed. This is a standalone diagnostic — it does NOT read the spreadsheet,
 * evaluate tiers, or message any real CSP/RM/DC. Use it to confirm the SMTP and
 * WhatsApp credentials actually deliver before relying on the daily run.
 */
export async function runTestDelivery(
  email: string,
  mobile: string,
): Promise<TestDeliveryResult> {
  const ranAt = new Date().toISOString();
  const result: TestDeliveryResult = {
    ranAt,
    email: { attempted: false, success: false },
    whatsapp: { attempted: false, success: false },
  };

  if (email) {
    result.email.attempted = true;
    const messageId = crypto.randomUUID();
    try {
      await verifyEmailTransport();
      await sendDigestEmail(email, "RM", TEST_EMAIL_BODY, messageId);
      result.email.success = true;
      result.email.messageId = messageId;
      logger.info({ email }, "Test email delivered");
    } catch (err) {
      result.email.error = err instanceof Error ? err.message : String(err);
      logger.error({ err, email }, "Test email failed");
    }
  }

  if (mobile) {
    result.whatsapp.attempted = true;
    try {
      const messageId = await sendDigestWhatsApp(mobile, TEST_WHATSAPP_BODY);
      result.whatsapp.success = true;
      result.whatsapp.messageId = typeof messageId === "string" ? messageId : null;
      logger.info({ mobile }, "Test WhatsApp delivered");
    } catch (err) {
      result.whatsapp.error = err instanceof Error ? err.message : String(err);
      logger.error({ err, mobile }, "Test WhatsApp failed");
    }
  }

  return result;
}
