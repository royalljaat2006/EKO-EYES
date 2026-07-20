import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import env from "../config/env";
import logger from "../utils/logger";
import { issueToken, passwordMatches } from "../security/auth";

const router = Router();

// Strict limit on login: 10 attempts per 15 min per IP, to blunt brute force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

const bodySchema = z.object({ password: z.string().min(1) });

/** POST /api/auth/login  { password } -> { token, expiresInHours } */
router.post("/auth/login", loginLimiter, (req, res) => {
  if (!env.DASHBOARD_PASSWORD) {
    return res.status(503).json({ error: "Auth is not configured on the server." });
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Password is required" });
  }
  if (!passwordMatches(parsed.data.password)) {
    logger.warn({ ip: req.ip }, "Failed dashboard login attempt");
    return res.status(401).json({ error: "Incorrect password" });
  }
  return res.json({ token: issueToken(), expiresInHours: env.AUTH_TOKEN_TTL_HOURS });
});

/** GET /api/auth/status - whether auth is configured (used by the login screen). */
router.get("/auth/status", (_req, res) => {
  res.json({ authConfigured: Boolean(env.DASHBOARD_PASSWORD) });
});

export default router;
