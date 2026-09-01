import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const RESET_EMAIL_TIMEOUT_MS = 10_000;
const RESET_WEB_URL_ENV = "PASSWORD_RESET_WEB_URL";
const RESET_FROM_EMAIL_ENV = "PASSWORD_RESET_FROM_EMAIL";
const RESET_APP_URL_ENV = "PASSWORD_RESET_APP_URL";

type DeliveryTransport = "resend" | "test_outbox";
type DeliveryFailure = "configuration" | "timeout" | "provider_error" | "unknown";

export type PasswordResetEmailDelivery = {
  transport: DeliveryTransport;
};

export type PasswordResetEmailOutboxEntry = {
  to: string;
  subject: string;
  resetUrl: string;
  appResetUrl?: string;
};

export class PasswordResetEmailError extends Error {
  constructor(public readonly outcome: DeliveryFailure) {
    super(`Password reset email ${outcome}`);
    this.name = "PasswordResetEmailError";
  }
}

let testOutbox: PasswordResetEmailOutboxEntry[] | undefined;

/**
 * Deliberately test-only transport. Integration tests opt in before importing
 * the Express app, so they exercise the real request flow without contacting
 * the email provider.
 */
export function usePasswordResetEmailOutboxForTests(): PasswordResetEmailOutboxEntry[] {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Password reset test outbox is only available when NODE_ENV=test");
  }
  testOutbox = [];
  return testOutbox;
}

export function clearPasswordResetEmailOutboxForTests(): void {
  testOutbox = undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Password reset email request timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function configurationError(): PasswordResetEmailError {
  return new PasswordResetEmailError("configuration");
}

function getResetWebUrl(token: string): string {
  const configured = process.env[RESET_WEB_URL_ENV]?.trim();
  if (!configured) throw configurationError();

  let resetUrl: URL;
  try {
    resetUrl = new URL(configured);
  } catch {
    throw configurationError();
  }

  if (
    resetUrl.protocol !== "https:" ||
    !resetUrl.hostname ||
    resetUrl.username ||
    resetUrl.password ||
    resetUrl.search ||
    resetUrl.hash ||
    !resetUrl.pathname.endsWith("/reset-password")
  ) {
    throw configurationError();
  }

  resetUrl.searchParams.set("token", token);
  return resetUrl.toString();
}

function getAppResetUrl(token: string): string | undefined {
  const configured = process.env[RESET_APP_URL_ENV]?.trim();
  if (!configured) return undefined;

  let appUrl: URL;
  try {
    appUrl = new URL(
      configured.endsWith("://") ? `${configured}reset-password` : configured,
    );
  } catch {
    throw configurationError();
  }

  if (
    appUrl.protocol !== "versafutsalapp:" ||
    appUrl.username ||
    appUrl.password ||
    appUrl.search ||
    appUrl.hash ||
    appUrl.hostname !== "reset-password" ||
    !["", "/"].includes(appUrl.pathname)
  ) {
    throw configurationError();
  }

  appUrl.searchParams.set("token", token);
  return appUrl.toString();
}

function getVerifiedSender(): string {
  const from = process.env[RESET_FROM_EMAIL_ENV]?.trim();
  if (!from || /[\r\n]/.test(from)) throw configurationError();
  return from;
}

export function assertPasswordResetEmailConfiguration(): void {
  getResetWebUrl("configuration-check");
  getAppResetUrl("configuration-check");
  getVerifiedSender();
}

export async function sendPasswordResetEmail(input: {
  email: string;
  name: string;
  token: string;
}): Promise<PasswordResetEmailDelivery> {
  const resetUrl = getResetWebUrl(input.token);
  const appResetUrl = getAppResetUrl(input.token);
  const safeName = escapeHtml(input.name);
  const safeResetUrl = escapeHtml(resetUrl);
  const safeAppResetUrl = appResetUrl ? escapeHtml(appResetUrl) : undefined;
  const from = getVerifiedSender();
  const subject = "Reset your Versa password";
  const appLinkText = appResetUrl
    ? `\n\nOr open the Versa app directly:\n${appResetUrl}`
    : "";
  const appLinkHtml = safeAppResetUrl
    ? `<p>Have the Versa app installed? <a href="${safeAppResetUrl}">Open the reset form in Versa</a>.</p>`
    : "";

  if (testOutbox) {
    testOutbox.push({ to: input.email, subject, resetUrl, appResetUrl });
    return { transport: "test_outbox" };
  }

  let response: Response;
  try {
    response = await withTimeout(
      connectors.proxy("resend", "/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [input.email],
          subject,
          text: `Hi ${input.name},\n\nUse this link to reset your Versa password. It expires in 30 minutes and can only be used once:\n${resetUrl}${appLinkText}\n\nIf you did not request this, you can ignore this email.`,
          html: `<p>Hi ${safeName},</p><p>Use the link below to reset your Versa password. It expires in 30 minutes and can only be used once.</p><p><a href="${safeResetUrl}">Reset your password</a></p>${appLinkHtml}<p>If you did not request this, you can ignore this email.</p>`,
        }),
      }),
      RESET_EMAIL_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof PasswordResetEmailError) throw error;
    if (error instanceof Error && error.message === "Password reset email request timed out") {
      throw new PasswordResetEmailError("timeout");
    }
    throw new PasswordResetEmailError("unknown");
  }

  if (!response.ok) {
    throw new PasswordResetEmailError("provider_error");
  }

  return { transport: "resend" };
}