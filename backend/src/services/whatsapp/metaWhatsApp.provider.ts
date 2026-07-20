import axios from "axios";
import env from "../../config/env";
import logger from "../../utils/logger";
import { WhatsAppProvider, normalizeMobile } from "./whatsapp.types";

/**
 * Meta WhatsApp Cloud API provider.
 *
 * Business-initiated notifications outside a live customer conversation must
 * use a pre-approved message template. The template referenced by
 * WHATSAPP_META_TEMPLATE_NAME must exist in the WhatsApp Manager and accept a
 * single body placeholder ({{1}}) for the alert text.
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = `https://graph.facebook.com/${env.WHATSAPP_META_API_VERSION}/${env.WHATSAPP_META_PHONE_NUMBER_ID}/messages`;
  }

  async sendMessage(toMobile: string, message: string): Promise<void> {
    const to = normalizeMobile(toMobile).replace("+", "");

    await axios.post(
      this.baseUrl,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: env.WHATSAPP_META_TEMPLATE_NAME,
          language: { code: env.WHATSAPP_META_TEMPLATE_LANG },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: message }],
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      },
    );

    logger.info({ to }, "WhatsApp message sent via Meta Cloud API");
  }
}
