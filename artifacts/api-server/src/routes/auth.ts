import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { signToken, requireAuth } from "../middlewares/auth";
import type { UserRole } from "@workspace/db";

const router: IRouter = Router();

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

    if (!email || !password || !name) {
      res.status(400).json({ error: "email, password, and name are required" });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    // Venue owners must provide a phone number for identity verification
    if ((role === "VENUE_OWNER") && !phoneNumber?.trim()) {
      res.status(400).json({ error: "Phone number is required for venue owner registration" });
      return;
    }

    // Check existing user
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Public registration only allows PLAYER or VENUE_OWNER.
    // ADMIN accounts must be seeded directly or promoted via a protected admin API.
    const ALLOWED_PUBLIC_ROLES: UserRole[] = ["PLAYER", "VENUE_OWNER"];
    const userRole: UserRole =
      role && ALLOWED_PUBLIC_ROLES.includes(role) ? role : "PLAYER";

    const [user] = await db
      .insert(usersTable)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        name,
        role: userRole,
        phoneNumber: phoneNumber?.trim() || null,
      })
      .returning();

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
    console.error("Register error:", err);
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

    const normalised = email.toLowerCase();

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalised))
      .limit(1);

    if (!user) {
      // Check if the address belongs to a soft-deleted account (email was anonymised)
      const [deletedUser] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(eq(usersTable.deletedOriginalEmail, normalised), isNotNull(usersTable.deletedAt)),
        )
        .limit(1);

      if (deletedUser) {
        res.status(401).json({ error: "This account has been deleted" });
        return;
      }

      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (user.deletedAt) {
      res.status(401).json({ error: "This account has been deleted" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
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
    console.error("Login error:", err);
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
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber.trim() || null;
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
        res.status(409).json({ error: "Email already in use" });
        return;
      }
      updates.email = trimmed;
    }

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, req.user!.userId))
      .returning();

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
    console.error("PATCH /auth/profile error:", err);
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
