import env from "./config/env";
import logger from "./utils/logger";
import app from "./app";
import { startScheduler } from "./jobs/scheduler";

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Inactivity alert API listening");
  startScheduler();
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});
