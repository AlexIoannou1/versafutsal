import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  assertSupportedImageSignature,
  AVATAR_IMAGE_POLICY,
  reencodeImageAsWebp,
  validateImageUploadFilename,
} from "../lib/image-upload-validation";

const router = Router();

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const AVATARS_DIR = path.join(UPLOADS_DIR, "avatars");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_IMAGE_POLICY.maxFileSizeBytes },
  fileFilter(_req, file, cb) {
    const validationError = validateImageUploadFilename(file, AVATAR_IMAGE_POLICY);
    if (validationError) {
      cb(new Error(validationError));
      return;
    }
    cb(null, true);
  },
});

function applyUpload(req: any, res: any): Promise<boolean> {
  return new Promise((resolve) => {
    upload.single("avatar")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const error =
          err.code === "LIMIT_FILE_SIZE"
            ? "Image file must be 8 MB or smaller"
            : err.message;
        res.status(400).json({ error });
        resolve(false);
      } else if (err) {
        res.status(400).json({ error: (err as Error).message ?? "Upload failed" });
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function resolveAvatarUrl(key: string): string {
  if (key.startsWith("http://") || key.startsWith("https://")) return key;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!domain) return key;
  return `https://${domain}/api/uploads/${key}`;
}

// POST /player/avatar — upload a profile photo and persist the URL
router.post(
  "/player/avatar",
  requireAuth,
  requireRole("PLAYER"),
  async (req, res) => {
    const ready = await applyUpload(req, res);
    if (!ready) return;

    try {
      if (!req.file) {
        res.status(400).json({ error: "No image file provided" });
        return;
      }

      const userId = req.user!.userId;

      let processed: Buffer;
      try {
        assertSupportedImageSignature(req.file.buffer, AVATAR_IMAGE_POLICY);
        processed = await reencodeImageAsWebp(req.file.buffer, { width: 400, height: 400 });
      } catch (imageError) {
        console.warn("Rejected avatar image upload:", imageError);
        res.status(400).json({
          error: imageError instanceof Error ? imageError.message : "Invalid image file",
        });
        return;
      }

      const avatarKey = `avatars/${userId}.webp`;
      const filePath = path.join(AVATARS_DIR, `${userId}.webp`);

      try {
        fs.mkdirSync(AVATARS_DIR, { recursive: true });
        await fs.promises.writeFile(filePath, processed);
      } catch (writeErr) {
        console.error("Filesystem write error:", writeErr);
        res.status(500).json({ error: "Failed to save image" });
        return;
      }

      const avatarUrl = resolveAvatarUrl(avatarKey) + `?v=${Date.now()}`;

      const [updated] = await db
        .update(usersTable)
        .set({ avatarUrl, updatedAt: new Date() })
        .where(eq(usersTable.id, userId))
        .returning({ avatarUrl: usersTable.avatarUrl });

      res.json({ avatarUrl: updated.avatarUrl });
    } catch (err) {
      console.error("POST /player/avatar error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
