import { customFetch } from "./custom-fetch";

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  phoneNumber?: string;
  city?: string | null;
}

export interface UpdateProfileResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    phoneNumber?: string | null;
    avatarUrl?: string | null;
    city?: string | null;
    createdAt: string;
  };
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UploadAvatarResponse {
  avatarUrl: string;
}

export async function updateProfile(data: UpdateProfileRequest): Promise<UpdateProfileResponse> {
  return customFetch<UpdateProfileResponse>("/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function changePassword(data: ChangePasswordRequest): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>("/api/auth/password", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function uploadAvatar(imageUri: string, mimeType: string): Promise<UploadAvatarResponse> {
  const formData = new FormData();
  const filename = imageUri.split("/").pop() ?? "avatar.jpg";
  formData.append("avatar", { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);
  return customFetch<UploadAvatarResponse>("/api/player/avatar", {
    method: "POST",
    body: formData,
  });
}
