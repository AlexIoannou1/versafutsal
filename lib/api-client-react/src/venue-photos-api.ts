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
 * The file object should have the shape that React Native / expo-image-picker returns:
 * { uri: string; type: string; name: string }
 */
export async function uploadVenuePhoto(
  venueId: string,
  file: { uri: string; type: string; name: string },
): Promise<UploadVenuePhotoResponse> {
  const formData = new FormData();
  formData.append("photo", { uri: file.uri, type: file.type, name: file.name } as unknown as Blob);

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
