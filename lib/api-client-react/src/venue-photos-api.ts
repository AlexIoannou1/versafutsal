import { customFetch, getApiUrl, getAuthToken } from "./custom-fetch";

export interface VenuePhoto {
  id: string;
  venueId: string;
  url: string;
  sortOrder: number;
  createdAt: string;
}

export interface UploadVenuePhotoResponse {
  photo: VenuePhoto;
}

/**
 * Upload a photo file for a venue using multipart form data.
 *
 * Accepts either:
 *  - A `File` or `Blob` instance (web — use a real Blob fetched from the picked URI)
 *  - A React Native file descriptor `{ uri, type, name }` (native — RN's fetch XHR extension)
 */
export type UploadProgressCallback = (progress: number | null) => void;

/**
 * Upload a photo with native XMLHttpRequest so the owner receives real transfer
 * progress on both Expo native and web builds.
 */
export async function uploadVenuePhotoWithProgress(
  venueId: string,
  file: File | Blob | { uri: string; type: string; name: string },
  onProgress?: UploadProgressCallback,
): Promise<UploadVenuePhotoResponse> {
  const formData = new FormData();

  if ("uri" in file) {
    // React Native path: append the RN file descriptor object.
    // RN's fetch implementation recognises this shape and streams the file bytes.
    formData.append("photo", file as unknown as Blob);
  } else {
    // Web/Node path: real Blob or File — append directly with a filename.
    const name = typeof File !== "undefined" && file instanceof File ? file.name : "photo.webp";
    formData.append("photo", file, name);
  }

  const authToken = await getAuthToken();
  const url = getApiUrl(`/api/owner/venues/${venueId}/photos/upload`);

  return new Promise<UploadVenuePhotoResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.responseType = "text";
    if (authToken) request.setRequestHeader("Authorization", `Bearer ${authToken}`);

    request.upload.onprogress = (event) => {
      onProgress?.(event.lengthComputable && event.total > 0 ? event.loaded / event.total : null);
    };
    request.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    request.onabort = () => reject(new Error("Upload was cancelled."));
    request.onload = () => {
      let payload: unknown = null;
      try {
        payload = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        reject(new Error("Upload failed because the server returned an invalid response."));
        return;
      }

      if (request.status < 200 || request.status >= 300) {
        const error = new Error(
          typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Upload failed. Please try again.",
        ) as Error & { data?: unknown };
        error.data = payload;
        reject(error);
        return;
      }

      resolve(payload as UploadVenuePhotoResponse);
    };
    request.send(formData);
  });
}

/**
 * Reorder photos by providing the full ordered list of photo IDs.
 * The first ID in the array becomes sortOrder 0 (cover photo).
 */
export async function reorderVenuePhotosWithResult(
  venueId: string,
  orderedIds: string[],
): Promise<{ success: boolean }> {
  return customFetch<{ success: boolean }>(`/api/owner/venues/${venueId}/photos/reorder`, {
    method: "PUT",
    body: JSON.stringify({ orderedIds }),
  });
}

/**
 * Delete a photo from a venue.
 */
export async function deleteVenuePhoto(venueId: string, photoId: string): Promise<void> {
  await customFetch<void>(`/api/owner/venues/${venueId}/photos/${photoId}`, {
    method: "DELETE",
  });
}
