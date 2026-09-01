import { customFetch } from "./custom-fetch";
import type {
  UpdateProfileRequest,
  UpdateProfileResponse,
} from "./generated/api.schemas";
export type { UpdateProfileRequest, UpdateProfileResponse } from "./generated/api.schemas";

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

