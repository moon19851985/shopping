import { roundMoney } from "./orderFees.js";
import { isHourlyPromotionActive, type OfferSlot } from "./offerSlots.js";

export type PromotionRowBase = {
  discountedPrice: number;
  originalPrice: number;
  offerDeliveryFee?: number | null;
  offerSlot?: string | null;
  hourStart?: string | null;
  hourEnd?: string | null;
  isStarterDeal?: number | null;
};

export function promotionPricing(row: PromotionRowBase) {
  const originalPrice = roundMoney(row.originalPrice);
  const discountedPrice = roundMoney(row.discountedPrice);
  const offerDeliveryFee =
    row.offerDeliveryFee != null && Number.isFinite(row.offerDeliveryFee)
      ? roundMoney(row.offerDeliveryFee)
      : null;
  const savingsPercent =
    originalPrice > 0 && discountedPrice < originalPrice
      ? Math.max(0, Math.round((1 - discountedPrice / originalPrice) * 100))
      : 0;
  const slot = row.offerSlot as OfferSlot | null;

  return {
    discountedPrice,
    originalPrice,
    savingsPercent,
    offerDeliveryFee,
    offerSlot: slot,
    isHourlyActive:
      slot === "HOURLY" ? isHourlyPromotionActive(row.hourStart, row.hourEnd) : undefined,
  };
}
