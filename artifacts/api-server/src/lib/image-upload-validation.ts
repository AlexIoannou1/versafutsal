import sharp, { type Metadata, type Sharp } from "sharp";

export const MAX_IMAGE_WIDTH = 8_000;
export const MAX_IMAGE_HEIGHT = 8_000;
export const MAX_INPUT_PIXELS = 24_000_000;

type SupportedImageType = "jpeg" | "png" | "webp" | "gif";

type UploadFileDetails = {
  originalname: string;
};

type ImageFormatRule = {
  type: SupportedImageType;
  mimeType: string;
  extensions: readonly string[];
  displayName: string;
};

const IMAGE_FORMATS: readonly ImageFormatRule[] = [
  { type: "jpeg", mimeType: "image/jpeg", extensions: [".jpg", ".jpeg"], displayName: "JPEG" },
  { type: "png", mimeType: "image/png", extensions: [".png"], displayName: "PNG" },
  { type: "webp", mimeType: "image/webp", extensions: [".webp"], displayName: "WebP" },
  { type: "gif", mimeType: "image/gif", extensions: [".gif"], displayName: "GIF" },
];

export type ImageUploadPolicy = {
  allowedTypes: readonly SupportedImageType[];
  maxFileSizeBytes: number;
};

export const AVATAR_IMAGE_POLICY: ImageUploadPolicy = {
  allowedTypes: ["jpeg", "png", "webp"],
  maxFileSizeBytes: 8 * 1024 * 1024,
};

export const VENUE_IMAGE_POLICY: ImageUploadPolicy = {
  allowedTypes: ["jpeg", "png", "webp"],
  maxFileSizeBytes: 5 * 1024 * 1024,
};

export class ImageUploadError extends Error {
  constructor(
    public readonly code:
      | "UNSUPPORTED_DECLARATION"
      | "INVALID_SIGNATURE"
      | "TYPE_MISMATCH"
      | "OVERSIZED_DIMENSIONS"
      | "CORRUPT_IMAGE",
    message: string,
  ) {
    super(message);
    this.name = "ImageUploadError";
  }
}

function formatAllowedTypes(policy: ImageUploadPolicy): string {
  return policy.allowedTypes
    .map((type) => IMAGE_FORMATS.find((format) => format.type === type)!.displayName)
    .join(", ");
}

function formatAllowedExtensions(policy: ImageUploadPolicy): string {
  return policy.allowedTypes
    .flatMap((type) => IMAGE_FORMATS.find((format) => format.type === type)!.extensions)
    .join(", ");
}

function isAllowedType(type: SupportedImageType, policy: ImageUploadPolicy): boolean {
  return policy.allowedTypes.includes(type);
}

/**
 * Checks the client filename before buffering. The Content-Type header is not
 * trusted: the actual image signature is verified after multer receives the file.
 */
export function validateImageUploadFilename(
  file: UploadFileDetails,
  policy: ImageUploadPolicy,
): string | null {
  const extension = file.originalname.slice(file.originalname.lastIndexOf(".")).toLowerCase();
  const hasAllowedExtension = policy.allowedTypes.some((type) =>
    IMAGE_FORMATS.find((format) => format.type === type)!.extensions.includes(extension),
  );
  if (!hasAllowedExtension) {
    return `Only ${formatAllowedTypes(policy)} image files are allowed. Use one of: ${formatAllowedExtensions(policy)}`;
  }

  return null;
}

/** Detects a format from its binary signature without trusting multipart headers. */
export function detectImageType(buffer: Buffer): SupportedImageType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "gif";
  }

  return null;
}

/**
 * Verifies the received bytes represent an allowed image format. This must run
 * before Sharp sees the buffer and deliberately does not trust Content-Type.
 */
export function assertSupportedImageSignature(
  buffer: Buffer,
  policy: ImageUploadPolicy,
): void {
  const actualType = detectImageType(buffer);
  if (!actualType || !isAllowedType(actualType, policy)) {
    throw new ImageUploadError(
      "INVALID_SIGNATURE",
      `Image contents must be a valid ${formatAllowedTypes(policy)} file`,
    );
  }

}

function isSharpPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit|too many pixels/i.test(error.message);
}

/**
 * Reads safe image metadata and emits a new WebP buffer. Sharp drops source
 * metadata unless withMetadata() is used, which this pipeline intentionally never does.
 */
export async function reencodeImageAsWebp(
  buffer: Buffer,
  resize?: { width: number; height: number },
): Promise<Buffer> {
  let image: Sharp;
  let metadata: Metadata;

  try {
    image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS });
    metadata = await image.metadata();
  } catch (error) {
    if (isSharpPixelLimitError(error)) {
      throw new ImageUploadError(
        "OVERSIZED_DIMENSIONS",
        `Image dimensions must not exceed ${MAX_IMAGE_WIDTH}×${MAX_IMAGE_HEIGHT} pixels or ${MAX_INPUT_PIXELS.toLocaleString()} total pixels`,
      );
    }
    throw new ImageUploadError("CORRUPT_IMAGE", "Image file is corrupt or could not be decoded");
  }

  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_IMAGE_WIDTH ||
    metadata.height > MAX_IMAGE_HEIGHT ||
    metadata.width * metadata.height > MAX_INPUT_PIXELS
  ) {
    throw new ImageUploadError(
      "OVERSIZED_DIMENSIONS",
      `Image dimensions must not exceed ${MAX_IMAGE_WIDTH}×${MAX_IMAGE_HEIGHT} pixels or ${MAX_INPUT_PIXELS.toLocaleString()} total pixels`,
    );
  }

  try {
    let pipeline = image.rotate();
    if (resize) {
      pipeline = pipeline.resize(resize.width, resize.height, { fit: "cover" });
    }

    return await pipeline.toFormat("webp", { quality: 85 }).toBuffer();
  } catch {
    throw new ImageUploadError("CORRUPT_IMAGE", "Image file is corrupt or could not be decoded");
  }
}