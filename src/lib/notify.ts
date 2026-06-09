import { db } from "../db.js";
import { getIo } from "./io.js";
import { startDispatch } from "./captainDispatch.js";

/** بعد الدفع — إشعار المطاعم والكباتن */
export function notifyOrderPaid(orderId: string) {
  notifyRestaurantOrderUpdate(orderId);
  getIo()?.to("captains").emit("order:paid", { orderId });
  startDispatch(orderId);
}

/** أي تغيير حالة — إشعار المطاعم لتحديث اللوحة */
export function notifyRestaurantOrderUpdate(orderId: string) {
  const io = getIo();
  if (!io) return;

  const restaurants = db
    .prepare(`SELECT DISTINCT restaurantId FROM OrderItem WHERE orderId = ?`)
    .all(orderId) as { restaurantId: string }[];

  for (const r of restaurants) {
    io.to(`restaurant:${r.restaurantId}`).emit("order:paid", { orderId });
    io.to(`restaurant:${r.restaurantId}`).emit("order:update", { orderId });
  }
}

/** تحديث لوحة الكابتن — تغيير حالة المطعم أو قبول كابتن آخر */
export function notifyCaptainsOrderUpdate(orderId: string) {
  const order = db
    .prepare(`SELECT status, captainId FROM "Order" WHERE id = ?`)
    .get(orderId) as { status: string; captainId: string | null } | undefined;
  if (!order) return;

  getIo()?.to("captains").emit("order:update", {
    orderId,
    status: order.status,
    captainId: order.captainId,
  });
}

/** عندما المطعم يجهّز الطلب — إشعار الكباتن للقبول */
export function notifyCaptainsOrderReady(orderId: string) {
  getIo()?.to("captains").emit("order:new", { orderId });
  startDispatch(orderId);
}
