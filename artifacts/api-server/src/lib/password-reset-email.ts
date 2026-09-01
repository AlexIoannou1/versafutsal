import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const RESET_EMAIL_TIMEOUT_MS = 10_000;

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

function getAppBaseUrl(): string {
  const configured =
    process.env.PASSWORD_RESET_APP_URL?.trim() || "versafutsalapp://";
  return configured.endsWith("://") ? configured : configured.replace(/\/+$/, "");
}

export async function sendPasswordResetEmail(input: {
  email: string;
  name: string;
  token: string;
}): Promise<void> {
  const appBaseUrl = getAppBaseUrl();
  const separator = appBaseUrl.endsWith("://") ? "" : "/";
  const resetUrl = `${appBaseUrl}${separator}reset-password?token=${encodeURIComponent(input.token)}`;
  const safeName = escapeHtml(input.name);
  const safeResetUrl = escapeHtml(resetUrl);
  const from =
    process.env.PASSWORD_RESET_FROM_EMAIL?.trim() ||
    "FutsalCY <onboarding@resend.dev>";

  const response = await withTimeout(
    connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: "Reset your FutsalCY password",
        text: `Hi ${input.name},\n\nUse this link to reset your FutsalCY password. It expires in 30 minutes and can only be used once:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>Hi ${safeName},</p><p>Use the link below to reset your FutsalCY password. It expires in 30 minutes and can only be used once.</p><p><a href="${safeResetUrl}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
      }),
    }),
    RESET_EMAIL_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Password reset email provider returned HTTP ${response.status}`);
  }
}