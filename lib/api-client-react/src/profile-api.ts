import { customFetch } from "./custom-fetch";
import type {
  UpdateProfileRequest,
  UpdateProfileResponse,
} from "./generated/api.schemas";
export type { UpdateProfileRequest, UpdateProfileResponse } from "./generated/api.schemas";

export interface UploadAvatarResponse {
  avatarUrl: string;
}

export async function updateProfile(data: UpdateProfileRequest): Promise<UpdateProfileResponse> {
  return customFetch<UpdateProfileResponse>("/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

