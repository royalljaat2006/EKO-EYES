import crypto from "node:crypto";
import axios from "axios";
import env from "../../config/env";
import logger from "../../utils/logger";
import { WhatsAppProvider, normalizeMobile } from "./whatsapp.types";

interface GoinfinitoResponse {
  status: string;
  messageack?: {
    guids?: Array<{
      guid: string;
      errors?: Array<{
        errorcode: number;
        errordescription?: string;
        errordesc?: string;
      }>;
    }>;
  };
}

export class GoinfinitoWhatsAppProvider implements WhatsAppProvider {
  private readonly url = "https://api.goinfinito.com/unified/v2/send";

  async sendMessage(toMobile: string, message: string): Promise<string> {
    // Normalize mobile numbers to digits only, removing the leading '+' for Goinfinito.
    const to = normalizeMobile(toMobile).replace("+", "");
    const from = normalizeMobile(env.CERF_FROM || "").replace("+", "");

    // Generate a unique 24-character hex ID (12 bytes)
    const uniqueId = crypto.randomBytes(12).toString("hex");

    // Parse variables for the 3-variable csp_inactivity_nudge template (ID 1778199)
    // Format: Hello {{1}}, we noticed your CSP terminal ({{2}}) has not been used for {{3}} days.
    const cspPattern = /Hello\s+(.+?),\s+we\s+noticed\s+your\s+CSP\s+terminal\s+\((.+?)\)\s+has\s+not\s+been\s+used\s+for\s+(\d+)\s+days/;
    const match = message.match(cspPattern);

    let templateParams = "";
    if (match) {
      const name = match[1].trim();
      const cspCode = match[2].trim();
      const days = match[3].trim();
      templateParams = `${name}~${cspCode}~${days}`;
    } else {
      // Fallback for non-CSP messages or test messages
      templateParams = `${message}~~`;
    }

    const payload = {
      apiver: "1.0",
      whatsapp: {
        ver: "2.0",
        dlr: env.CERF_DLR_URL ? { url: env.CERF_DLR_URL } : undefined,
        messages: [
          {
            coding: "1",
            id: uniqueId,
            msgtype: "1",
            text: "",
            templateinfo: `${env.CERF_TEMPLATE_ID}~${templateParams}`,
            type: "",
            filename: "",
            contenttype: "",
            mediadata: "",
            b_urlinfo: "",
            addresses: [
              {
                seq: "",
                to,
                from,
                tag: "",
              },
            ],
          },
        ],
      },
    };

    logger.debug({ to, uniqueId }, "Sending WhatsApp message via Goinfinito");

    const response = await axios.post<GoinfinitoResponse>(this.url, payload, {
      headers: {
        Authorization: `Bearer ${env.CERF_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 15_000,
    });

    const resData = response.data;

    if (resData.status !== "Success") {
      throw new Error(`Goinfinito API response status: ${resData.status}`);
    }

    const guidInfo = resData.messageack?.guids?.[0];
    if (!guidInfo) {
      throw new Error("Goinfinito API response missing message GUID info");
    }

    if (guidInfo.errors && guidInfo.errors.length > 0) {
      const err = guidInfo.errors[0];
      throw new Error(
        `Goinfinito message rejected: Code ${err.errorcode} - ${
          err.errordescription || err.errordesc || "Unknown error"
        }`,
      );
    }

    const guid = guidInfo.guid;
    logger.info(
      { to, uniqueId, guid },
      "WhatsApp message sent successfully via Goinfinito",
    );

    return guid;
  }
}
