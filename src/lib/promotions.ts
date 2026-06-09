import { db } from "../db.js";
import { roundMoney } from "./orderFees.js";

/** Lowest active promotion price for a product, or null if none. */
export function activePromotionPrice(productId: string): number | null {
  const row = db
    .prepare(
      `SELECT discountedPrice FROM Promotion
       WHERE productId = ? AND isActive = 1
       ORDER BY discountedPrice ASC LIMIT 1`
    )
    .get(productId) as { discountedPrice: number } | undefined;

  return row ? roundMoney(row.discountedPrice) : null;
}

export function effectiveUnitPrice(productId: string, catalogPrice: number): number {
  const promo = activePromotionPrice(productId);
  if (promo === null) return roundMoney(catalogPrice);
  return promo;
}
