import assert from "node:assert/strict";
import sharp from "sharp";
import {
  assertSupportedImageSignature,
  AVATAR_IMAGE_POLICY,
  detectImageType,
  ImageUploadError,
  MAX_IMAGE_WIDTH,
  reencodeImageAsWebp,
  validateImageUploadFilename,
  VENUE_IMAGE_POLICY,
} from "./lib/image-upload-validation";

const onePixel = { create: { width: 1, height: 1, channels: 3 as const, background: "#3273dc" } };
const jpeg = await sharp(onePixel).jpeg().toBuffer();
const png = await sharp(onePixel).png().toBuffer();
const webp = await sharp(onePixel).webp().toBuffer();
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

assert.equal(detectImageType(jpeg), "jpeg");
assert.equal(detectImageType(png), "png");
assert.equal(detectImageType(webp), "webp");
assert.equal(detectImageType(gif), "gif");
assert.equal(detectImageType(Buffer.from("not an image")), null);

for (const [buffer, mimetype, originalname] of [
  [jpeg, "image/jpeg", "avatar.jpg"],
  [png, "image/png", "avatar.png"],
  [webp, "image/webp", "avatar.webp"],
] as const) {
  assert.equal(
    validateImageUploadFilename({ originalname }, AVATAR_IMAGE_POLICY),
    null,
  );
  assert.doesNotThrow(() =>
    assertSupportedImageSignature(buffer, AVATAR_IMAGE_POLICY),
  );
  const output = await reencodeImageAsWebp(buffer, { width: 400, height: 400 });
  assert.equal((await sharp(output).metadata()).format, "webp");
}

assert.equal(
  validateImageUploadFilename({ originalname: "venue.gif" }, VENUE_IMAGE_POLICY),
  null,
);
assert.doesNotThrow(() =>
  assertSupportedImageSignature(gif, VENUE_IMAGE_POLICY),
);
assert.equal((await sharp(await reencodeImageAsWebp(gif)).metadata()).format, "webp");

assert.match(
  validateImageUploadFilename({ originalname: "avatar.php" }, AVATAR_IMAGE_POLICY) ?? "",
  /Only JPEG, PNG, WebP image files are allowed/,
);
assert.equal(
  validateImageUploadFilename({ originalname: "avatar.jpg" }, AVATAR_IMAGE_POLICY),
  null,
);
assert.throws(
  () =>
    assertSupportedImageSignature(
      Buffer.from("MZ executable bytes"),
      AVATAR_IMAGE_POLICY,
    ),
  (error: unknown) => error instanceof ImageUploadError && error.code === "INVALID_SIGNATURE",
);
assert.doesNotThrow(
  () => assertSupportedImageSignature(jpeg, AVATAR_IMAGE_POLICY),
);

const withExif = await sharp(onePixel)
  .withMetadata({ exif: { IFD0: { Copyright: "private metadata" } } })
  .jpeg()
  .toBuffer();
assert.ok((await sharp(withExif).metadata()).exif);
const reencoded = await reencodeImageAsWebp(withExif);
assert.equal((await sharp(reencoded).metadata()).exif, undefined);

await assert.rejects(
  () => reencodeImageAsWebp(Buffer.concat([png.subarray(0, 8), Buffer.from("corrupt data")])),
  (error: unknown) => error instanceof ImageUploadError && error.code === "CORRUPT_IMAGE",
);

const tooWide = await sharp({
  create: { width: MAX_IMAGE_WIDTH + 1, height: 1, channels: 3, background: "#000000" },
})
  .png()
  .toBuffer();
await assert.rejects(
  () => reencodeImageAsWebp(tooWide),
  (error: unknown) => error instanceof ImageUploadError && error.code === "OVERSIZED_DIMENSIONS",
);

console.log("image upload validation regression checks passed");