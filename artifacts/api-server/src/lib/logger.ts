import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body",
  "res.body",
  "res.headers['set-cookie']",
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "email",
  "name",
  "phoneNumber",
  "user.email",
  "user.name",
  "user.phoneNumber",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: LOG_REDACT_PATHS,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
