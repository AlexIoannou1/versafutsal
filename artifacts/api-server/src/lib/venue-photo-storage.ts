import { Client } from "@replit/object-storage";

const VENUE_PHOTO_PREFIX = "uploads/venue-photos/";

const storage = new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID });

function assertSuccess<T>(result: { ok: boolean; value?: T; error?: { message?: string } | string }): T {
  if (!result.ok) {
    const message =
      typeof result.error === "string" ? result.error : result.error?.message ?? "Object storage request failed";
    throw new Error(message);
  }
  return result.value as T;
}

export function isVenuePhotoStorageKey(value: string): boolean {
  return value.startsWith(VENUE_PHOTO_PREFIX);
}

export async function saveVenuePhoto(key: string, image: Buffer): Promise<void> {
  assertSuccess(await storage.uploadFromBytes(key, image, { compress: false }));
}

export async function readVenuePhoto(key: string): Promise<Buffer> {
  const [image] = assertSuccess(await storage.downloadAsBytes(key));
  return image;
}

export async function removeVenuePhoto(key: string): Promise<void> {
  assertSuccess(await storage.delete(key, { ignoreNotFound: true }));
}