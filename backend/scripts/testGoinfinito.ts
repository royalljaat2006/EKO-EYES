import logger from "../src/utils/logger";
import { GoinfinitoWhatsAppProvider } from "../src/services/whatsapp/goinfinitoWhatsApp.provider";
import env from "../src/config/env";

const toMobile = process.argv[2];
const testMessage = process.argv[3] || "Test message from inactivity alert agent";

if (!toMobile) {
  logger.error("Usage: npx ts-node scripts/testGoinfinito.ts <mobile_number> [message]");
  process.exit(1);
}

if (!env.CERF_API_KEY || !env.CERF_FROM || !env.CERF_TEMPLATE_ID) {
  logger.error("Error: CERF_API_KEY, CERF_FROM, and CERF_TEMPLATE_ID must be set in your .env file.");
  process.exit(1);
}

logger.info(
  { to: toMobile, from: env.CERF_FROM, templateId: env.CERF_TEMPLATE_ID },
  "Testing Goinfinito WhatsApp integration...",
);

const provider = new GoinfinitoWhatsAppProvider();
provider
  .sendMessage(toMobile, testMessage)
  .then((guid) => {
    logger.info({ guid }, "Test message sent successfully!");
    process.exit(0);
  })
  .catch((err: any) => {
    logger.error({ err: err.message || err }, "Test message failed to send");
    process.exit(1);
  });
