import readline from "node:readline";
import { google } from "googleapis";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

// Load existing environment variables
dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> =>
  new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log("=== Gmail API OAuth2 Refresh Token Generator ===");
  console.log("This helper script will generate a Refresh Token for your Gmail API.\n");

  let clientId = process.env.GMAIL_CLIENT_ID;
  let clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId) {
    clientId = await question("Enter your GMAIL_CLIENT_ID: ");
  } else {
    console.log(`Using GMAIL_CLIENT_ID from environment: ${clientId}`);
  }

  if (!clientSecret) {
    clientSecret = await question("Enter your GMAIL_CLIENT_SECRET: ");
  } else {
    console.log("Using GMAIL_CLIENT_SECRET from environment: [configured]");
  }

  clientId = clientId.trim();
  clientSecret = clientSecret.trim();

  if (!clientId || !clientSecret) {
    console.error("Error: Client ID and Client Secret are required.");
    rl.close();
    process.exit(1);
  }

  const redirectUri = "http://localhost:8085";
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const scopes = ["https://www.googleapis.com/auth/gmail.send"];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });

  console.log("\n1. Open the following URL in your browser to authorize the application:");
  console.log("\x1b[36m%s\x1b[0m", authUrl);
  console.log("\nWaiting for redirect on http://localhost:8085...");

  const server = http.createServer(async (req, res) => {
    try {
      const urlParams = new URL(req.url || "", `http://${req.headers.host}`);
      const code = urlParams.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authentication successful!</h1><p>You can close this tab and return to the terminal.</p>");
        server.close();

        console.log("\nCode received successfully! Exchanging for tokens...");
        const { tokens } = await oauth2Client.getToken(code);
        console.log("\n=== AUTHENTICATION SUCCESSFUL ===");
        console.log(`GMAIL_REFRESH_TOKEN: ${tokens.refresh_token}`);
        console.log("=================================\n");

        const writeEnv = await question("Would you like to write these values to your backend .env? (y/n): ");
        if (writeEnv.trim().toLowerCase() === "y") {
          const envPath = path.join(__dirname, "../.env");
          if (fs.existsSync(envPath)) {
            let content = fs.readFileSync(envPath, "utf8");

            const updates: Record<string, string> = {
              EMAIL_PROVIDER: "gmail_api",
              GMAIL_CLIENT_ID: clientId || "",
              GMAIL_CLIENT_SECRET: clientSecret || "",
              GMAIL_REFRESH_TOKEN: tokens.refresh_token || "",
            };

            for (const [key, value] of Object.entries(updates)) {
              const regex = new RegExp(`^${key}=.*$`, "m");
              if (regex.test(content)) {
                content = content.replace(regex, `${key}=${value}`);
              } else {
                content += `\n${key}=${value}`;
              }
            }
            fs.writeFileSync(envPath, content, "utf8");
            console.log("Successfully updated backend/.env!");
          } else {
            console.log("backend/.env not found, could not write variables automatically.");
          }
        }
        rl.close();
        process.exit(0);
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("No code found in redirect URL");
      }
    } catch (error: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Error: ${error.message}`);
      console.error("Error exchanging code:", error);
      server.close();
      rl.close();
      process.exit(1);
    }
  });

  server.listen(8085);
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
