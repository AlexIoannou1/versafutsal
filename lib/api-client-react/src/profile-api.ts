import { customFetch } from "./custom-fetch";

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  phoneNumber?: string;
}

export interface UpdateProfileResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    phoneNumber?: string | null;
    createdAt: string;
  };
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
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
