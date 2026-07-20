import { Router } from "express";
import env from "../config/env";
import logger from "../utils/logger";
import { findByMobile, suppressFromReply } from "../services/cspEngagement.service";
import { normalizeMobile } from "../services/whatsapp/whatsapp.types";
import { updateAlertDeliveryStatus } from "../services/alertStore.service";

const router = Router();

/**
 * Inbound WhatsApp replies (Meta Cloud API webhook).
 *
 * Without this the agent talks AT people with no way to answer — which is the
 * root of the frustration. A CSP whose device is broken currently has no way to
 * say so, and just keeps getting messages.
 *
 * Any reply stops further nudges and hands the case to a human. We deliberately
 * do NOT try to parse intent cleverly: a reply of any kind means "a person is
 * trying to tell us something", and that is always a reason to stop automating.
 */

/** Classify the reply just enough to route it. Everything else is "needs a human". */
export function classifyReply(text: string): { reason: string } {
  const t = text.trim().toLowerCase();
  if (/\b(stop|unsubscribe|do not|dont|don't)\b/.test(t)) return { reason: "opted-out" };
  if (/\b(help|issue|problem|not working|broken|error)\b/.test(t)) return { reason: "needs-help" };
  if (/\b(closed|shut|holiday|leave|hospital|ill|sick)\b/.test(t)) return { reason: "unavailable" };
  return { reason: "replied" };
}

/** Meta calls this once to verify the webhook URL. */
router.get("/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
    token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  ) {
    logger.info("WhatsApp webhook verified");
    return res.status(200).send(String(challenge ?? ""));
  }
  return res.sendStatus(403);
});

interface MetaWebhookBody {
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; text?: { body?: string } }[];
      };
    }[];
  }[];
}

router.post("/whatsapp/webhook", (req, res) => {
  // Always 200 quickly — Meta retries aggressively on any non-2xx.
  res.sendStatus(200);

  try {
    const body = req.body as MetaWebhookBody;
    const now = new Date().toISOString();

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          const from = msg.from ? normalizeMobile(msg.from) : "";
          const text = msg.text?.body ?? "";
          if (!from) continue;

          const cspCode = findByMobile(from);
          if (!cspCode) {
            logger.warn({ from }, "WhatsApp reply from an unknown number — ignoring");
            continue;
          }

          const { reason } = classifyReply(text);
          suppressFromReply(cspCode, reason, text, now);

          logger.info(
            { cspCode, reason, text },
            "CSP replied — automated nudges suppressed, handed to a human",
          );
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to process inbound WhatsApp webhook");
  }
});

/**
 * Goinfinito DLR webhook endpoint.
 * Goinfinito POSTs status updates (sent, delivered, read, failed, etc.) here.
 */
router.post("/whatsapp/goinfinito-dlr", (req, res) => {
  // Always return 200 OK promptly.
  res.sendStatus(200);

  try {
    const payload = req.body;
    logger.info({ payload }, "Received Goinfinito WhatsApp DLR webhook");

    // Extract potential message id / guid and status
    let guid = "";
    let status = "";
    let errorCode = "";
    let errorDesc = "";

    // 1. Check if it's the standard Meta-like statuses structure
    if (payload.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]) {
      const statusObj = payload.entry[0].changes[0].value.statuses[0];
      guid = statusObj.id;
      status = statusObj.status;
      if (statusObj.errors?.[0]) {
        errorCode = String(statusObj.errors[0].code || "");
        errorDesc = statusObj.errors[0].message || statusObj.errors[0].title || "";
      }
    } 
    // 2. Check if it is a flat structure commonly sent by ValueFirst Unified APIs
    else {
      guid = payload.guid || payload.messageId || payload.message_id || payload.requestId || payload.id || "";
      status = payload.status || payload.event || payload.deliveryStatus || "";
      errorCode = payload.errorCode || payload.error_code || "";
      errorDesc = payload.errorDesc || payload.errorDescription || payload.error_desc || "";
    }

    if (!guid) {
      logger.warn({ payload }, "Received Goinfinito DLR webhook without identifiable message GUID");
      return;
    }

    const matched = updateAlertDeliveryStatus(
      guid,
      status,
      errorCode ? `Code ${errorCode}: ${errorDesc}` : undefined
    );

    if (matched) {
      logger.info({ guid, status }, "Successfully updated WhatsApp delivery status in audit log");
    } else {
      logger.warn({ guid, status }, "Received WhatsApp DLR update for unknown message GUID");
    }
  } catch (err) {
    logger.error({ err }, "Failed to process Goinfinito WhatsApp DLR webhook");
  }
});

export default router;
