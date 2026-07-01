import { Router } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files are allowed"));
      return;
    }
    cb(null, true);
  },
});

// POST /player/avatar — upload a profile photo and persist the URL
router.post(
  "/player/avatar",
  requireAuth,
  requireRole("PLAYER"),
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No image file provided" });
        return;
      }

      const userId = req.user!.userId;
      const ext = req.file.originalname.split(".").pop() ?? "jpg";
      const objectKey = `avatars/${userId}.${ext}`;

      const client = new Client();
      const { ok, error } = await client.uploadFromBytes(objectKey, req.file.buffer, {
        contentType: req.file.mimetype,
      });

      if (!ok) {
        console.error("Object storage upload error:", error);
        res.status(500).json({ error: "Failed to upload image" });
        return;
      }

      // Build a public URL — Object Storage serves via the standard download API
      const { url: downloadUrl } = await client.downloadAsUrl(objectKey);
      const avatarUrl = downloadUrl;

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
