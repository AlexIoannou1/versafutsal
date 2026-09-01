import { customFetch } from "./custom-fetch";
import type { UploadAvatarResponse } from "./profile-api";

export async function uploadAvatar(
  imageUri: string,
  mimeType: string,
): Promise<UploadAvatarResponse> {
  const formData = new FormData();
  const filename = getAvatarUploadFilename(mimeType);
  const response = await fetch(imageUri);
  const blob = await response.blob();
  const file = new File([blob], filename, { type: mimeType });
  formData.append("avatar", file);
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
