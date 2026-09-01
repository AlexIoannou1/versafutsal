import { customFetch } from "./custom-fetch";
import type { UploadAvatarResponse } from "./profile-api";

export async function uploadAvatar(
  imageUri: string,
  mimeType: string,
): Promise<UploadAvatarResponse> {
  const formData = new FormData();
  const filename = getAvatarUploadFilename(mimeType);
  formData.append("avatar", { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);
  return customFetch<UploadAvatarResponse>("/api/player/avatar", {
    method: "POST",
    body: formData,
  });
}

function getAvatarUploadFilename(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "avatar.png";
    case "image/webp":
      return "avatar.webp";
    default:
      return "avatar.jpg";
  }
}
