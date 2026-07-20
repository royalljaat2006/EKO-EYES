import { verifyEmailTransport, sendDigestEmail } from "../src/services/email.service";
import env from "../src/config/env";

async function main() {
  console.log(`=== Email Transport Test ===`);
  console.log(`Using Provider: ${env.EMAIL_PROVIDER}`);

  try {
    console.log("Verifying connection/transport credentials...");
    await verifyEmailTransport();
    console.log("✅ Connection verified successfully!");

    const testRecipient = process.argv[2];
    if (testRecipient) {
      console.log(`Sending a test email to: ${testRecipient}...`);
      await sendDigestEmail(
        testRecipient,
        "RM",
        "This is a test inactivity digest email sent from the Inactivity Alert Agent to test your integration configurations."
      );
      console.log("✅ Test email sent successfully!");
    } else {
      console.log("\nNote: Provide a recipient email address as a CLI argument to send a test mail.");
      console.log("Example: npm run email:test user@example.com");
    }
  } catch (error: any) {
    console.error("❌ Test failed!");
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);
