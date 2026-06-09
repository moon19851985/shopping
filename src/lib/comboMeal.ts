import { db } from "../db.js";
import { normalizeImageUrl } from "./imageUrl.js";
import { roundMoney } from "./orderFees.js";

export type ComboItemRow = {
  productId: string;
  productName: string;
  quantity: number;
  productPrice: number;
};

export function loadComboItems(comboProductId: string): ComboItemRow[] {
  return db
    .prepare(
      `SELECT pi.componentProductId as productId, pi.quantity,
              p.name as productName, p.price as productPrice
       FROM ComboItem pi
       JOIN Product p ON p.id = pi.componentProductId
       WHERE pi.comboProductId = ? AND p.isAvailable = 1`
    )
    .all(comboProductId) as ComboItemRow[];
}

export function sumComponentCatalogPrice(items: { productId: string; quantity: number }[]) {
  return roundMoney(
    items.reduce((s, item) => {
      const p = db.prepare(`SELECT price FROM Product WHERE id = ?`).get(item.productId) as
        | { price: number }
        | undefined;
      return s + (p?.price ?? 0) * item.quantity;
    }, 0)
  );
}

export function enrichComboProduct(product: Record<string, unknown>) {
  const items = loadComboItems(product.id as string);
  const catalogTotal = roundMoney(
    items.reduce((s, i) => s + Number(i.productPrice) * i.quantity, 0)
  );
  const promo = db
    .prepare(
      `SELECT id, discountedPrice, reason, offerSlot, hourStart, hourEnd
       FROM Promotion WHERE productId = ? AND isActive = 1 LIMIT 1`
    )
    .get(product.id as string) as
    | {
        id: string;
        discountedPrice: number;
        reason: string;
        offerSlot: string | null;
        hourStart: string | null;
        hourEnd: string | null;
      }
    | undefined;

  const basePrice = roundMoney(Number(product.price));
  const hasDailyOffer =
    !!promo?.offerSlot && String(promo.offerSlot).trim().length > 0;
  const displayPrice =
    promo && hasDailyOffer ? roundMoney(promo.discountedPrice) : basePrice;

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: basePrice,
    displayPrice,
    catalogTotal: catalogTotal > 0 ? catalogTotal : undefined,
    imageUrl: normalizeImageUrl(product.imageUrl as string | null),
    category: product.category,
    mealType: product.mealType || null,
    isComboMeal: true,
    isStarterMeal: !!(product.isStarterMeal as number),
    items,
    promotion: promo
      ? {
          id: promo.id,
          discountedPrice: roundMoney(promo.discountedPrice),
          reason: promo.reason,
          offerSlot: promo.offerSlot,
          hourStart: promo.hourStart,
          hourEnd: promo.hourEnd,
          hasDailyOffer,
        }
      : null,
    createdAt: product.createdAt,
  };
}
