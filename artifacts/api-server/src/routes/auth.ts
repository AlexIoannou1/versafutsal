import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { normalizePhoneNumber } from "@workspace/api-zod";
import { signToken, requireAuth } from "../middlewares/auth";
import type { UserRole } from "@workspace/db";
import {
  canonicalizeAccountIdentifier,
  createLoginRateLimiter,
  getCanonicalClientAddress,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_RATE_LIMIT_MESSAGE,
} from "../lib/login-rate-limiter";
import { databaseLoginRateLimitStore } from "../lib/login-rate-limiter-store";

const router: IRouter = Router();
const loginRateLimiter = createLoginRateLimiter({
  store: databaseLoginRateLimitStore,
  secret: process.env.SESSION_SECRET ?? process.env.JWT_SECRET ?? "",
});

function uniqueViolationField(err: unknown): "email" | "phoneNumber" | null {
  const error = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  if (error?.code !== "23505" && error?.cause?.code !== "23505") return null;
  const constraint = error.constraint ?? error.cause?.constraint ?? "";
  if (constraint.includes("email")) return "email";
  if (constraint.includes("phone")) return "phoneNumber";
  return null;
}

// POST /auth/register
router.post("/auth/register", async (req, res) => {
  try {
    const { email, password, name, role, phoneNumber } = req.body as {
      email: string;
      password: string;
      name: string;
      role?: UserRole;
      phoneNumber?: string;
    };

    if (!email || !password || !name || !phoneNumber) {
      const field = !name ? "name" : !email ? "email" : !password ? "password" : "phoneNumber";
      res.status(400).json({ error: "Full name, email, password, and phone number are required", field });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    let canonicalPhone: string;
    try {
      canonicalPhone = normalizePhoneNumber(phoneNumber);
    } catch {
      res.status(400).json({ error: "Phone number is invalid", field: "phoneNumber" });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    // Check existing user
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "Email already registered", field: "email" });
      return;
    }

    const existingPhone = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.phoneNumber, canonicalPhone))
      .limit(1);
    if (existingPhone.length > 0) {
      res.status(409).json({ error: "Phone number already registered", field: "phoneNumber" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Public registration only allows PLAYER or VENUE_OWNER.
    // ADMIN accounts must be seeded directly or promoted via a protected admin API.
    const ALLOWED_PUBLIC_ROLES: UserRole[] = ["PLAYER", "VENUE_OWNER"];
    const userRole: UserRole =
      role && ALLOWED_PUBLIC_ROLES.includes(role) ? role : "PLAYER";

    let user: typeof usersTable.$inferSelect;
    try {
      [user] = await db
        .insert(usersTable)
        .values({
          email: normalizedEmail,
          passwordHash,
          name: name.trim(),
          role: userRole,
          phoneNumber: canonicalPhone,
        })
        .returning();
    } catch (err) {
      const field = uniqueViolationField(err);
      if (field === "email") {
        res.status(409).json({ error: "Email already registered", field });
        return;
      }
      if (field === "phoneNumber") {
        res.status(409).json({ error: "Phone number already registered", field });
        return;
      }
      throw err;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phoneNumber: user.phoneNumber,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    req.log.error({ event: "auth.register.failed", requestId: req.id }, "Registration request failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/login
router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body as {
      email: string;
      password: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const normalised = canonicalizeAccountIdentifier(email);

    const rateLimit = await loginRateLimiter.check({
      accountIdentifier: normalised,
      clientAddress: getCanonicalClientAddress(req),
    });
    if (!rateLimit.allowed) {
      const retryAfterSeconds = rateLimit.retryAfterSeconds ?? 1;
      req.log.warn(
        {
          event: "auth.login.rate_limited",
          requestId: req.id,
          scopes: rateLimit.blockedScopes,
          retryAfterSeconds,
        },
        "Login rate limit exceeded",
      );
      res
        .set("Retry-After", String(retryAfterSeconds))
        .status(429)
        .json({ error: LOGIN_RATE_LIMIT_MESSAGE });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalised))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: INVALID_CREDENTIALS_MESSAGE });
      return;
    }

    if (user.deletedAt) {
      res.status(401).json({ error: INVALID_CREDENTIALS_MESSAGE });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: INVALID_CREDENTIALS_MESSAGE });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phoneNumber: user.phoneNumber,
        avatarUrl: user.avatarUrl,
        city: user.city,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (err) {
    req.log.error(
      { event: "auth.login.failed", requestId: req.id },
      "Login request failed",
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /auth/me
router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      user: {
        userId: user.id,
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phoneNumber: user.phoneNumber,
        avatarUrl: user.avatarUrl,
        city: user.city,
      },
    });
  } catch (err) {
    console.error("GET /auth/me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /auth/profile — update name, email, phoneNumber, city
router.patch("/auth/profile", requireAuth, async (req, res) => {
  try {
    const { name, email, phoneNumber, city } = req.body as {
      name?: string;
      email?: string;
      phoneNumber?: string;
      city?: string;
    };

    const updates: Partial<typeof usersTable.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updates.name = name.trim();
    if (phoneNumber !== undefined) {
      try {
        updates.phoneNumber = normalizePhoneNumber(phoneNumber);
      } catch {
        res.status(400).json({ error: "Phone number is invalid", field: "phoneNumber" });
        return;
      }
      const existingPhone = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.phoneNumber, updates.phoneNumber))
        .limit(1);
      if (existingPhone.length > 0 && existingPhone[0].id !== req.user!.userId) {
        res.status(409).json({ error: "Phone number already in use", field: "phoneNumber" });
        return;
      }
    }
    if (city !== undefined) updates.city = city?.trim() || null;

    if (email !== undefined) {
      const trimmed = email.trim().toLowerCase();
      // Check uniqueness if changing email
      const existing = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, trimmed))
        .limit(1);
      if (existing.length > 0 && existing[0].id !== req.user!.userId) {
        res.status(409).json({ error: "Email already in use", field: "email" });
        return;
      }
      updates.email = trimmed;
    }

    let updated: typeof usersTable.$inferSelect;
    try {
      [updated] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, req.user!.userId))
        .returning();
    } catch (err) {
      const field = uniqueViolationField(err);
      if (field === "email") {
        res.status(409).json({ error: "Email already in use", field });
        return;
      }
      if (field === "phoneNumber") {
        res.status(409).json({ error: "Phone number already in use", field });
        return;
      }
      throw err;
    }

    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        phoneNumber: updated.phoneNumber,
        avatarUrl: updated.avatarUrl,
        city: updated.city,
        createdAt: updated.createdAt,
      },
    });
  } catch (err) {
    req.log.error({ event: "auth.profile_update.failed", requestId: req.id }, "Profile update failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /auth/password — change password
router.patch("/auth/password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword and newPassword are required" });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: "New password must be at least 6 characters" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, req.user!.userId));

    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /auth/password error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
