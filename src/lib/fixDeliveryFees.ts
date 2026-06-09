import { db } from "../db.js";
import { calcDeliveryFee } from "./geo.js";
import { roundMoney } from "./orderFees.js";

/** Fees above this were caused by wrong GPS (e.g. Riyadh default) — recalc from stored order location. */
const MAX_REASONABLE_FEE = 40;

/** Fix corrupt deliveryFee rows using the order's saved customer coordinates + restaurant locations. */
export function fixUnreasonableDeliveryFees() {
  const rate = Number(process.env.DELIVERY_RATE_PER_KM ?? 2.5);
  const minFee = Number(process.env.DELIVERY_MIN_FEE ?? 5);

  const orders = db
    .prepare(
      `SELECT id, deliveryLat, deliveryLng, subtotal FROM "Order" WHERE deliveryFee > ?`
    )
    .all(MAX_REASONABLE_FEE) as {
    id: string;
    deliveryLat: number;
    deliveryLng: number;
    subtotal: number;
  }[];

  for (const order of orders) {
    const restaurants = db
      .prepare(
        `SELECT DISTINCT r.lat, r.lng FROM OrderItem oi
         JOIN Restaurant r ON r.id = oi.restaurantId WHERE oi.orderId = ?`
      )
      .all(order.id) as { lat: number; lng: number }[];

    if (restaurants.length === 0) continue;

    const deliveryFee = roundMoney(
      calcDeliveryFee(restaurants, order.deliveryLat, order.deliveryLng, rate, minFee)
    );
    const total = roundMoney(order.subtotal + deliveryFee);

    db.prepare(
      `UPDATE "Order" SET deliveryFee = ?, total = ?, updatedAt = datetime('now') WHERE id = ?`
    ).run(deliveryFee, total, order.id);
  }
}

export function capDeliveryFee(fee: number): number {
  const maxFee = Number(process.env.DELIVERY_MAX_FEE ?? 150);
  return roundMoney(Math.min(fee, maxFee));
}
