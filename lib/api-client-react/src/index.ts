export * from "./generated/api";
export * from "./generated/api.schemas";
export { uploadVenuePhoto, reorderVenuePhotos } from "./venue-photos-api";
export type { VenuePhoto, UploadVenuePhotoResponse } from "./venue-photos-api";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
export { updateProfile, changePassword, uploadAvatar } from "./profile-api";
export type {
  UpdateProfileRequest,
  UpdateProfileResponse,
  ChangePasswordRequest,
} from "./profile-api";
export {
  useCreateManualBooking,
  useUpdateOwnerBooking,
  useGetOwnerBookingAudit,
  useGetOwnerStats,
} from "./manual-booking-api";
export type {
  CreateManualBookingRequest,
  CreateManualBookingResponse,
  UpdateOwnerBookingRequest,
  AuditLogEntry,
  GetOwnerBookingAuditResponse,
  OwnerStatsParams,
  OwnerStatsResponse,
} from "./manual-booking-api";
export {
  useListFavourites,
  useFavouriteIds,
  useToggleFavourite,
} from "./favourites-api";
export type {
  FavouriteVenueSummary,
  ListFavouritesResponse,
  FavouriteIdsResponse,
} from "./favourites-api";
export {
  getStripeConfig,
  deleteAccount,
  clearPushToken,
  listPaymentMethods,
  createSetupIntent,
  removePaymentMethod,
} from "./account-api";
export type { SavedCard, ListPaymentMethodsResponse } from "./account-api";
export {
  getOwnerConnectConfig,
  createOwnerConnectAccount,
  getOwnerConnectOnboardingLink,
  getOwnerConnectStatus,
  disconnectOwnerConnectAccount,
  deleteOwnerAccount,
} from "./owner-connect-api";
export type { OwnerConnectConfig, OwnerConnectStatus } from "./owner-connect-api";
export {
  useListBlocks,
  useCreateBlock,
  useDeleteBlock,
  useListBlocksForVenues,
} from "./blocks-api";
export type {
  AvailabilityBlock,
  BlockType,
  CreateBlockRequest,
  CreateBlockResponse,
  ListBlocksResponse,
} from "./blocks-api";
