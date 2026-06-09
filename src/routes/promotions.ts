import { Router } from "express";
import { db } from "../db.js";
import { cityNameFromQuery } from "../lib/cities.js";
import { roundMoney } from "../lib/orderFees.js";
import { normalizeImageUrl } from "../lib/imageUrl.js";
import {
  OFFER_SLOTS,
  parseOfferSlot,
  isHourlyPromotionActive,
  type OfferSlot,
} from "../lib/offerSlots.js";
import { promotionPricing } from "../lib/promotionEnrich.js";

const router = Router();

type PromotionRow = {
  id: string;
  restaurantId: string;
  productId: string;
  discountedPrice: number;
  reason: string;
  createdAt: string;
  productName: string;
  originalPrice: number;
  imageUrl: string | null;
  category: string;
  mealType: string;
  restaurantName: string;
  restaurantLogo: string | null;
  restaurantLat: number;
  restaurantLng: number;
  isStarterDeal?: number | null;
  offerSlot?: string | null;
  hourStart?: string | null;
  hourEnd?: string | null;
  offerDeliveryFee?: number | null;
};

function enrichPromotion(row: PromotionRow) {
  const pricing = promotionPricing(row);

  return {
    id: row.id,
    restaurantId: row.restaurantId,
    productId: row.productId,
    discountedPrice: pricing.discountedPrice,
    originalPrice: pricing.originalPrice,
    savingsPercent: pricing.savingsPercent,
    reason: row.reason,
    createdAt: row.createdAt,
    isStarterDeal: !!row.isStarterDeal,
    offerSlot: pricing.offerSlot,
    offerDeliveryFee: pricing.offerDeliveryFee,
    hourStart: row.hourStart ?? null,
    hourEnd: row.hourEnd ?? null,
    isHourlyActive: pricing.isHourlyActive,
    product: {
      id: row.productId,
      name: row.productName,
      price: pricing.originalPrice,
      imageUrl: normalizeImageUrl(row.imageUrl),
      category: row.category,
      mealType: row.mealType,
    },
    restaurant: {
      id: row.restaurantId,
      name: row.restaurantName,
      logoUrl: normalizeImageUrl(row.restaurantLogo),
      lat: row.restaurantLat,
      lng: row.restaurantLng,
    },
  };
}

const PROMOTION_SELECT = `
  SELECT pr.id, pr.restaurantId, pr.productId, pr.discountedPrice, pr.reason, pr.createdAt,
         pr.isStarterDeal, pr.offerSlot, pr.hourStart, pr.hourEnd, pr.offerDeliveryFee,
         p.name as productName, p.price as originalPrice, p.imageUrl, p.category, p.mealType,
         r.name as restaurantName, r.logoUrl as restaurantLogo, r.lat as restaurantLat, r.lng as restaurantLng
  FROM Promotion pr
  JOIN Product p ON p.id = pr.productId
  JOIN Restaurant r ON r.id = pr.restaurantId
  WHERE pr.isActive = 1 AND p.isAvailable = 1 AND r.isActive = 1
    AND pr.offerSlot IS NOT NULL AND TRIM(pr.offerSlot) != ''
`;

function fetchPromotionRows(city: string | undefined, slot: OfferSlot | null) {
  let sql = PROMOTION_SELECT;
  const params: unknown[] = [];
  if (city) {
    sql += ` AND r.city = ?`;
    params.push(city);
  }
  if (slot) {
    sql += ` AND pr.offerSlot = ?`;
    params.push(slot);
  }
  sql += ` ORDER BY pr.createdAt DESC`;
  const rows = db.prepare(sql).all(...params) as PromotionRow[];
  if (slot !== "HOURLY") return rows;
  return rows.filter((r) => isHourlyPromotionActive(r.hourStart, r.hourEnd));
}

router.get("/slot-counts", (req, res) => {
  const city = cityNameFromQuery(req.query.city as string | undefined);
  const counts = Object.fromEntries(
    OFFER_SLOTS.map((slot) => [slot, 0])
  ) as Record<OfferSlot, number>;
  for (const slot of OFFER_SLOTS) {
    counts[slot] = fetchPromotionRows(city, slot).length;
  }
  res.json({ counts, city });
});

router.get("/", (req, res) => {
  const city = cityNameFromQuery(req.query.city as string | undefined);
  const slot = parseOfferSlot(req.query.slot as string | undefined);
  const rows = fetchPromotionRows(city, slot);
  res.json({ promotions: rows.map(enrichPromotion), city, slot });
});

export default router;
