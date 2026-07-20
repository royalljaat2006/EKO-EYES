import twilio from "twilio";
import env from "../../config/env";
import logger from "../../utils/logger";
import { WhatsAppProvider, normalizeMobile } from "./whatsapp.types";

export class TwilioWhatsAppProvider implements WhatsAppProvider {
  private readonly client: ReturnType<typeof twilio>;

  constructor() {
    this.client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }

  async sendMessage(toMobile: string, message: string): Promise<void> {
    const to = `whatsapp:${normalizeMobile(toMobile)}`;

    await this.client.messages.create({
      from: env.TWILIO_WHATSAPP_FROM,
      to,
      body: message,
    });

    logger.info({ to }, "WhatsApp message sent via Twilio");
  }
}
