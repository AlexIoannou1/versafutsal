import { customFetch } from "./custom-fetch";
import type { UploadAvatarResponse } from "./profile-api";

export async function uploadAvatar(
  imageUri: string,
  mimeType: string,
): Promise<UploadAvatarResponse> {
  const formData = new FormData();
  const filename = imageUri.split("/").pop() ?? "avatar.jpg";
  formData.append("avatar", { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);
  return customFetch<UploadAvatarResponse>("/api/player/avatar", {
    method: "POST",
    body: formData,
  });
}
