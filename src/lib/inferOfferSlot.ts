import type { OfferSlot } from "./offerSlots.js";

const CATEGORY_RULES: { slot: OfferSlot; keywords: string[] }[] = [
  { slot: "GRILL", keywords: ["مشو", "شواء", "grill", "كباب", "تكة", "لحم"] },
  { slot: "SHAWARMA", keywords: ["شاور", "shawarma"] },
  { slot: "FAST_FOOD", keywords: ["برجر", "burger", "سريع", "fast", "وجبات سريعة"] },
  { slot: "PIZZA", keywords: ["بيتز", "pizza"] },
  { slot: "SWEETS", keywords: ["حلى", "حلو", "كيك", "cake", "معجن", "حلويات"] },
  { slot: "COFFEE", keywords: ["قهو", "coffee", "لاتيه", "كابتش", "موكا"] },
  { slot: "BREAKFAST", keywords: ["فطور", "breakfast", "بيض"] },
  { slot: "ARABIC", keywords: ["كبسة", "مندي", "عرب", "أرز", "رز"] },
  { slot: "SEAFOOD", keywords: ["بحري", "سمك", "جمبري", "seafood", "سلمون"] },
  { slot: "ASIAN", keywords: ["آسيو", "صين", "سوشي", "نودل", "noodle", "تايلند"] },
  { slot: "HEALTHY", keywords: ["صحي", "سلط", "healthy", "دايت"] },
  { slot: "SANDWICHES", keywords: ["سندو", "sandwich"] },
  { slot: "DRINKS", keywords: ["مشرو", "عصير", "drink", "juice", "شاي"] },
];

/** يحدد قسم العروض اليومية من صنف/نوع المنتج */
export function inferOfferSlotFromProduct(category: string, mealType?: string | null): OfferSlot {
  const hay = `${category} ${mealType ?? ""}`.trim().toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => hay.includes(k))) return rule.slot;
  }
  if (mealType === "BREAKFAST") return "BREAKFAST";
  if (mealType === "LUNCH") return "FAST_FOOD";
  if (mealType === "DINNER") return "GRILL";
  return "OTHER";
}

export function deliveryOfferReason(fee: number): string {
  if (fee <= 0) return "توصيل مجاني";
  return `توصيل ${fee} ر.س`;
}
