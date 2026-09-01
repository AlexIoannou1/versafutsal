import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { UserRole } from "@workspace/db";

const JWT_SECRET = process.env["JWT_SECRET"];

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required but was not set. " +
      "Set it to a long random string before starting the server.",
  );
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  sessionVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// JWT_SECRET is validated above; non-null assertion is safe here.
const SECRET = JWT_SECRET!;

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  const token = authHeader.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, SECRET) as JwtPayload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  if (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion < 0) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Verify the account is active and invalidate tokens issued before a
  // security-sensitive credential change.
  (async () => {
    const [row] = await db
      .select({
        deletedAt: usersTable.deletedAt,
        sessionVersion: usersTable.sessionVersion,
      })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId))
      .limit(1);

    if (!row || row.deletedAt || row.sessionVersion !== payload.sessionVersion) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    req.user = payload;
    next();
  })().catch((err) => {
    console.error("requireAuth DB check error:", err);
    res.status(500).json({ error: "Internal server error" });
  });
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "30d" });
}
