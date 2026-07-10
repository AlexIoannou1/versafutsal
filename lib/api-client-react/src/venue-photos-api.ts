import { customFetch } from "./custom-fetch";

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
export async function uploadVenuePhoto(
  venueId: string,
  file: File | Blob | { uri: string; type: string; name: string },
): Promise<UploadVenuePhotoResponse> {
  const formData = new FormData();

  if ("uri" in file) {
    // React Native path: append the RN file descriptor object.
    // RN's fetch implementation recognises this shape and streams the file bytes.
    formData.append("photo", file as unknown as Blob);
  } else {
    // Web/Node path: real Blob or File — append directly with a filename.
    const name = file instanceof File ? file.name : "photo.webp";
    formData.append("photo", file, name);
  }

  return customFetch<UploadVenuePhotoResponse>(`/api/owner/venues/${venueId}/photos/upload`, {
    method: "POST",
    body: formData,
  });
}

/**
 * Reorder photos by providing the full ordered list of photo IDs.
 * The first ID in the array becomes sortOrder 0 (cover photo).
 */
export async function reorderVenuePhotos(
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
