/** Round to 2 decimal places for SAR amounts. */
export function roundMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Attach monetary fields from the Order row as stored at checkout.
 * Never recalculate deliveryFee from distance on read — fees are immutable after order creation.
 */
export function attachLockedOrderMoney<T extends Record<string, unknown>>(order: T) {
  return {
    ...order,
    deliveryFee: roundMoney(order.deliveryFee),
    subtotal: roundMoney(order.subtotal),
    total: roundMoney(order.total),
    deliveryLat: Number(order.deliveryLat),
    deliveryLng: Number(order.deliveryLng),
  };
}
