import { customFetch } from "./custom-fetch";
import type { UploadAvatarResponse } from "./profile-api";

export async function uploadAvatar(
  imageUri: string,
  mimeType: string,
): Promise<UploadAvatarResponse> {
  const formData = new FormData();
  const filename = imageUri.split("/").pop() ?? "avatar.jpg";
  const response = await fetch(imageUri);
  const blob = await response.blob();
  const file = new File([blob], filename, { type: mimeType });
  formData.append("avatar", file);
  return customFetch<UploadAvatarResponse>("/api/player/avatar", {
    method: "POST",
    body: formData,
  });
}
