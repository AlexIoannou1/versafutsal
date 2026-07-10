---
name: Expo ImagePicker FormData — web vs native
description: How to correctly send expo-image-picker assets as multipart uploads on both web and native platforms.
---

## The rule
Never use the React Native `{ uri, type, name }` FormData trick on web. On web, append a real `File` or `Blob` object instead.

**Why:** React Native's custom XHR/fetch implementation intercepts the `{ uri, type, name }` object appended to FormData and resolves the URI to file bytes before sending. Browsers have no such extension — they just serialize the plain JS object as a string, so multer receives no file at all (returns "No image file provided").

**How to apply:** Branch on `Platform.OS === 'web'` in any component that uploads files from ImagePicker:

```typescript
if (Platform.OS === "web") {
  const resp = await fetch(asset.uri);       // asset.uri is a blob: URL on web
  const blob = await resp.blob();
  const mimeType = asset.mimeType ?? blob.type ?? "image/jpeg";
  const ext = mimeType.split("/")[1] ?? "jpg";
  fileArg = new File([blob], `photo.${ext}`, { type: mimeType });
} else {
  fileArg = { uri: asset.uri, type: asset.mimeType ?? "image/jpeg", name: `photo.jpg` };
}
```

## Android MIME type
Some Android builds of expo-image-picker send `application/octet-stream` instead of `image/jpeg`. The multer `fileFilter` must accept it; sharp detects the real format from buffer magic bytes anyway.

## @replit/object-storage — must pass bucketId explicitly
`@replit/object-storage` v1 auto-discovers its bucket ID by calling `REPLIT_SIDECAR_ENDPOINT + "/object-storage/default-bucket"`. In this project the sidecar is unreachable, causing "A bucket name is needed to use Cloud Storage." at runtime.

Fix: always pass the bucket ID explicitly using the `DEFAULT_OBJECT_STORAGE_BUCKET_ID` env var:
```typescript
new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID } as any)
```
Use a shared factory (`makeStorageClient()`) rather than `new Client()` everywhere.

## Multer error handling
Always wrap `multer.single(...)` in a manual callback to convert multer errors into JSON 400 responses, not HTML 500s:

```typescript
function applyPhotoUpload(req: any, res: any): Promise<boolean> {
  return new Promise((resolve) => {
    photoUpload.single("photo")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError || err) {
        res.status(400).json({ error: (err as Error).message ?? "Upload failed" });
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
```
