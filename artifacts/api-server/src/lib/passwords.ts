import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;
const PASSWORD_HASH_VERSION = "v1";

/**
 * Bcrypt only processes 72 input bytes. A versioned SHA-256 prehash keeps the
 * full UTF-8 password value meaningful while the database continues to store
 * only a standard bcrypt cost-12 hash.
 */
function bcryptInputForNewPassword(password: string): string {
  const digest = createHash("sha256").update(password, "utf8").digest("base64url");
  return `${PASSWORD_HASH_VERSION}:${digest}`;
}

export async function hashNewPassword(password: string): Promise<string> {
  return bcrypt.hash(bcryptInputForNewPassword(password), BCRYPT_COST);
}

export function createPasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Legacy accounts were bcrypt-hashed directly. Checking both encodings lets
 * them sign in and change their password without a forced migration.
 */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [legacyMatch, versionedMatch] = await Promise.all([
    bcrypt.compare(password, passwordHash),
    bcrypt.compare(bcryptInputForNewPassword(password), passwordHash),
  ]);
  return legacyMatch || versionedMatch;
}