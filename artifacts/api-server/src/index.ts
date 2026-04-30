import app from "./app";
import { logger } from "./lib/logger";
import { startReminderDispatcher } from "./lib/notifications";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start in-process poller that delivers scheduled reminder push notifications
  startReminderDispatcher();
  logger.info("Reminder dispatcher started (60s interval)");
});
