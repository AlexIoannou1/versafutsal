import app from "./app";
import { logger } from "./lib/logger";
import { startReminderDispatcher } from "./lib/notifications";
import { startSmsReminderDispatcher } from "./lib/sms-reminders";
import { smsProvider } from "./lib/sms-provider";
import { startEliteRecovery } from "./lib/elite";

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
  startEliteRecovery();
  logger.info("Reminder dispatcher started (60s interval)");
  startSmsReminderDispatcher(logger);
  logger.info({ enabled: smsProvider.enabled, provider: smsProvider.name }, "SMS reminder dispatcher started");
});
