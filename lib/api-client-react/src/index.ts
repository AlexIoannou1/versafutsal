export * from "./generated/api";
export * from "./generated/api.schemas";
// Backward-compat re-exports for renamed generated symbols
export {
  adminDisableVenue as disableVenue,
  useAdminDisableVenue as useDisableVenue,
} from "./generated/api";
export {
  uploadVenuePhotoWithProgress,
  reorderVenuePhotosWithResult,
} from "./venue-photos-api";
export type {
  VenuePhoto,
  UploadVenuePhotoResponse,
  UploadProgressCallback,
} from "./venue-photos-api";
export {
  setBaseUrl,
  setAuthTokenGetter,
  getApiUrl,
  getAuthToken,
} from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
export { validateRequestBody, validationMessage } from "./validation";
export {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  getPhoneCountry,
  getPhoneCountryForE164,
  isValidNationalPhoneNumber,
  nationalNumberFromE164,
  normalizePhoneNumber,
} from "@workspace/api-zod";
export type { PhoneCountryCode } from "@workspace/api-zod";
export type { ValidationIssue, ValidationResult } from "./validation";
export { updateProfile } from "./profile-api";
export { uploadAvatar } from "./uploadAvatar";
export type {
  UpdateProfileRequest,
  UpdateProfileResponse,
} from "./profile-api";
export {
  assessNewPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_VERSION,
  PASSWORD_RECOMMENDED_LENGTH,
} from "@workspace/api-zod";
export type {
  NewPasswordAssessment,
  PasswordPolicyIssue,
  PasswordStrength,
} from "@workspace/api-zod";
export {
  useCreateManualBooking,
  useUpdateOwnerBooking,
  useGetOwnerBookingAudit,
  useGetAdminBookingAudit,
} from "./manual-booking-api";
export type {
  CreateManualBookingRequest,
  CreateManualBookingResponse,
  UpdateOwnerBookingRequest,
  AuditLogEntry,
  GetOwnerBookingAuditResponse,
  GetAdminBookingAuditResponse,
} from "./manual-booking-api";
export type { GetOwnerStatsParams as OwnerStatsParams } from "./generated/api.schemas";
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
export type {
  OwnerConnectConfig,
  OwnerConnectStatus,
} from "./owner-connect-api";
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
export { captureBookingPayment } from "./booking-capture-api";
export type { CheckoutResponse, CaptureResponse } from "./booking-capture-api";
export {
  useOwnerNotifications,
  useMarkNotificationsRead,
} from "./owner-notifications-api";
export type {
  OwnerNotification,
  ListOwnerNotificationsResponse,
} from "./owner-notifications-api";
export {
  usePlayerNotifications,
  useMarkPlayerNotificationsRead,
} from "./player-notifications-api";
export type {
  PlayerNotification,
  ListPlayerNotificationsResponse,
} from "./player-notifications-api";
