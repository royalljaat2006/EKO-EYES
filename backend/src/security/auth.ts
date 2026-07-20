import crypto from "node:crypto";
import { NextFunction, Request, Response } from "express";
import env from "../config/env";
import logger from "../utils/logger";

/**
 * Minimal, dependency-free session authentication (ISO 27001 A.5.15 / A.8.5).
 *
 * Flow: the user posts the dashboard password once, gets back an HMAC-signed
 * token, and sends it as `Authorization: Bearer <token>` thereafter. The token
 * is signed (not encrypted) — it carries only an expiry, no secrets — and is
 * verified in constant time on every protected request.
 *
 * This is deliberately simple: one shared dashboard password, no user accounts.
 * If per-user identity is ever needed, this is where it would grow.
 */

// A per-process signing secret. A configured secret keeps tokens valid across
// restarts; otherwise we generate one and tokens reset when the server does.
const SIGNING_SECRET =
  env.AUTH_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");

if (!env.AUTH_TOKEN_SECRET && env.DASHBOARD_PASSWORD) {
  logger.warn(
    "AUTH_TOKEN_SECRET not set — a random one was generated. Sessions will end on restart. Set it in .env for stable sessions.",
  );
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", SIGNING_SECRET).update(payload).digest());
}

/** Timing-safe string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function issueToken(): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        iat: Date.now(),
        exp: Date.now() + env.AUTH_TOKEN_TTL_HOURS * 3_600_000,
      }),
    ),
  );
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!safeEqual(signature, sign(payload))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return typeof decoded.exp === "number" && decoded.exp > Date.now();
  } catch {
    return false;
  }
}

/** Constant-time check of a submitted password against the configured one. */
export function passwordMatches(submitted: string): boolean {
  if (!env.DASHBOARD_PASSWORD) return false;
  return safeEqual(submitted, env.DASHBOARD_PASSWORD);
}

let warnedAuthOff = false;

/**
 * Middleware guarding protected data routes.
 *
 * When DASHBOARD_PASSWORD is set it enforces a valid session token. When it is
 * NOT set, auth is treated as "not yet enabled" and requests pass through (with
 * a one-time warning). This keeps local development working while the login UI
 * is still being built; set a password to turn enforcement on.
 *
 * TODO(security): once the frontend login gate lands, flip this to fail closed.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.DASHBOARD_PASSWORD) {
    if (!warnedAuthOff) {
      logger.warn(
        "DASHBOARD_PASSWORD is not set — API auth is DISABLED. Data routes are open. Set it to enable login.",
      );
      warnedAuthOff = true;
    }
    next();
    return;
  }

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
