import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import env from "./config/env";
import logger from "./utils/logger";
import healthRoutes from "./routes/health.routes";
import authRoutes from "./routes/auth.routes";
import inactivityRoutes from "./routes/inactivity.routes";
import whatsappRoutes from "./routes/whatsapp.routes";
import { requireAuth } from "./security/auth";

const app = express();
// We sit behind localhost / a reverse proxy; trust it so rate-limit sees real IPs.
app.set("trust proxy", 1);

const allowedOrigins = env.DASHBOARD_CORS_ORIGIN.split(",").map((o) => o.trim());

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));

// Capture the raw body so the WhatsApp webhook can verify its HMAC signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(pinoHttp({ logger }));

// General API rate limit — a coarse ceiling against scraping / DoS (A.8.6).
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests." },
  }),
);

// --- Public routes (no session token) ---
app.use("/api", healthRoutes); // liveness only
app.use("/api", authRoutes); // login (own strict limiter)
app.use("/api", whatsappRoutes); // authenticated by HMAC signature, not a token

// --- Protected routes (require a valid session token) ---
app.use("/api", requireAuth, inactivityRoutes);

import path from "path";

// Serve static files from React frontend
const frontendDistPath = path.join(process.cwd(), "../frontend/dist");
app.use(express.static(frontendDistPath));

// SPA wildcard fallback: Serve index.html for non-API routes
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, "index.html"), (err) => {
    if (err) {
      res.status(404).json({ error: "Not found" });
    }
  });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
