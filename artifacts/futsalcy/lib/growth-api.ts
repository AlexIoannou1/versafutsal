import {
  createOwnerPromotion as createPromotion,
  getOwnerGrowthAnalytics,
  getPlayerVenueStreak,
  listOwnerPromotions,
  quoteBookingGrowthIncentive,
  previewBookingGrowthIncentive,
  setVenueStreak as updateStreak,
  type CreatePromotionRequest,
  updateOwnerPromotion,
} from "@workspace/api-client-react";

// Keep screen imports stable while using the generated, authenticated client.
export { getOwnerGrowthAnalytics, getPlayerVenueStreak, listOwnerPromotions };
export const createOwnerPromotion = (data: CreatePromotionRequest) => createPromotion(data);
export const setVenueStreak = (venueId: string, enabled: boolean) => updateStreak(venueId, { enabled });
export type {
  GrowthPromotion as Promotion,
  GrowthAnalytics,
  PricingQuote as BookingQuote,
  PlayerVenueStreak,
} from "@workspace/api-client-react";

export const setOwnerPromotionEnabled = (id: string, enabled: boolean) =>
  updateOwnerPromotion(id, { enabled });
export const getBookingQuote = (bookingId: string, promoCode?: string) =>
  quoteBookingGrowthIncentive(bookingId, { promoCode });
export const previewBookingQuote = (pitchId: string, startAt: string, promoCode?: string) =>
  previewBookingGrowthIncentive({ pitchId, startAt, promoCode });
