import nodemailer, { Transporter } from "nodemailer";
import { google } from "googleapis";
import env from "../config/env";
import logger from "../utils/logger";
import { InactivityRecord, NotificationRole } from "../types";
import { getTemplate, renderTemplate } from "./templates.service";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
}

// For compiling emails to raw MIME string when using Gmail API
const streamTransporter = nodemailer.createTransport({
  streamTransport: true,
  newline: "windows",
  buffer: true,
});

async function sendViaGmailApi(mailOptions: nodemailer.SendMailOptions): Promise<void> {
  const oauth2Client = new google.auth.OAuth2(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    refresh_token: env.GMAIL_REFRESH_TOKEN,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // Compile mail options using nodemailer's stream transport to get a valid RFC 822 MIME message
  const info = await new Promise<any>((resolve, reject) => {
    streamTransporter.sendMail(mailOptions, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  const rawMessage = info.message; // Buffer containing raw MIME email
  const base64SafeMessage = rawMessage
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: base64SafeMessage,
    },
  });
}

export function buildAlertSubject(record: InactivityRecord): string {
  return `Inactivity Alert: ${record.targetPersonName} inactive for ${record.days} days`;
}

export function buildAlertBody(record: InactivityRecord, role: NotificationRole): string {
  return [
    `This is an automated inactivity alert.`,
    ``,
    `Target Person : ${record.targetPersonName}`,
    `Inactive Days : ${record.days}`,
    `Notified As   : ${role}`,
    ``,
    `Please follow up with the target person as soon as possible.`,
    ``,
    `-- E.Y.E.S. (EKO Yield & Escalation System)`,
  ].join("\n");
}

export async function sendAlertEmail(
  record: InactivityRecord,
  role: NotificationRole,
  recipient: string,
  messageId?: string,
): Promise<void> {
  if (!recipient) {
    throw new Error(`Missing ${role} email address for ${record.targetPersonName}`);
  }

  const textBody = buildAlertBody(record, role);
  const htmlBody = messageId
    ? `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.5; color: #333;">
        ${textBody.replace(/\n/g, "<br />")}
        <img src="${env.SERVER_BASE_URL}/api/email/track?messageId=${messageId}" width="1" height="1" style="display:none;" />
      </div>`
    : undefined;

  const mailOptions: nodemailer.SendMailOptions = {
    from: env.ALERT_EMAIL_FROM,
    to: recipient,
    subject: buildAlertSubject(record),
    text: textBody,
    html: htmlBody,
  };

  if (env.EMAIL_PROVIDER === "gmail_api") {
    await sendViaGmailApi(mailOptions);
  } else {
    await getTransporter().sendMail(mailOptions);
  }

  logger.info({ recipient, role, person: record.targetPersonName }, "Alert email sent");
}

/** The digest email subject line — its own function so the draft-only preview path (digest.service.ts) can show EXACTLY what a real send would use, not a re-derived approximation. */
export function buildDigestSubject(role: NotificationRole): string {
  return renderTemplate(getTemplate("emailDigestSubject"), { role });
}

/** One consolidated digest to a single recipient, covering all their people. */
export async function sendDigestEmail(
  recipient: string,
  role: NotificationRole,
  body: string,
  messageId?: string,
): Promise<void> {
  if (!recipient) throw new Error(`Missing ${role} email address`);

  const htmlBody = messageId
    ? `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.5; color: #333;">
        ${body.replace(/\n/g, "<br />")}
        <img src="${env.SERVER_BASE_URL}/api/email/track?messageId=${messageId}" width="1" height="1" style="display:none;" />
      </div>`
    : undefined;

  const mailOptions: nodemailer.SendMailOptions = {
    from: env.ALERT_EMAIL_FROM,
    to: recipient,
    subject: buildDigestSubject(role),
    text: body,
    html: htmlBody,
  };

  if (env.EMAIL_PROVIDER === "gmail_api") {
    await sendViaGmailApi(mailOptions);
  } else {
    await getTransporter().sendMail(mailOptions);
  }

  logger.info({ recipient, role }, "Digest email sent");
}

export async function verifyEmailTransport(): Promise<void> {
  if (env.EMAIL_PROVIDER === "gmail_api") {
    const oauth2Client = new google.auth.OAuth2(
      env.GMAIL_CLIENT_ID,
      env.GMAIL_CLIENT_SECRET,
    );
    oauth2Client.setCredentials({
      refresh_token: env.GMAIL_REFRESH_TOKEN,
    });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    // This will throw if credentials/API is not valid or ready
    await gmail.users.getProfile({ userId: "me" });
  } else {
    await getTransporter().verify();
  }
}
