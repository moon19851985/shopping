import { Router } from "express";
import { z } from "zod";
import { db, cuid } from "../db.js";
import { authMiddleware } from "../lib/auth.js";
import { calcDeliveryFee } from "../lib/geo.js";
import { attachLockedOrderMoney, roundMoney } from "../lib/orderFees.js";
import { capDeliveryFee } from "../lib/fixDeliveryFees.js";
import { notifyCaptainsOrderReady, notifyCaptainsOrderUpdate, notifyRestaurantOrderUpdate } from "../lib/notify.js";
import {
  completeDispatchAccept,
  DISPATCH_OFFER_SECONDS,
  findVisibleOffersForCaptain,
  captainCanAcceptOrder,
  rejectDispatchOffer,
} from "../lib/captainDispatch.js";
import { getOrCreateCaptain } from "../lib/captain.js";
import { getIo } from "../lib/io.js";
import { periodSql } from "../lib/statsPeriod.js";
import { effectiveUnitPrice } from "../lib/promotions.js";

const router = Router();

const checkoutSchema = z.object({
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1) })).min(1),
  deliveryLat: z.number(),
  deliveryLng: z.number(),
  deliveryAddress: z.string().min(3),
});

router.post("/estimate", authMiddleware(["CUSTOMER"]), (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const estimate = buildOrderTotals(parsed.data.items, parsed.data.deliveryLat, parsed.data.deliveryLng);
  if ("error" in estimate) {
    res.status(400).json({ error: estimate.error });
    return;
  }
  res.json(estimate);
});

router.post("/checkout", authMiddleware(["CUSTOMER"]), (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const estimate = buildOrderTotals(parsed.data.items, parsed.data.deliveryLat, parsed.data.deliveryLng);
  if ("error" in estimate) {
    res.status(400).json({ error: estimate.error });
    return;
  }

  const orderId = cuid();
  const paymentId = cuid();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO "Order" (id, customerId, status, deliveryLat, deliveryLng, deliveryAddress, subtotal, deliveryFee, total)
       VALUES (?, ?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      req.user!.sub,
      parsed.data.deliveryLat,
      parsed.data.deliveryLng,
      parsed.data.deliveryAddress,
      estimate.subtotal,
      estimate.deliveryFee,
      estimate.total
    );

    const insItem = db.prepare(
      `INSERT INTO OrderItem (id, orderId, restaurantId, productId, quantity, unitPrice, lineTotal) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of estimate.lineItems) {
      insItem.run(cuid(), orderId, item.restaurantId, item.productId, item.quantity, item.unitPrice, item.lineTotal);
    }

    db.prepare(`INSERT INTO Payment (id, orderId, amount, status) VALUES (?, ?, ?, 'PENDING')`).run(
      paymentId,
      orderId,
      estimate.total
    );
  });
  tx();

  const order = db.prepare(`SELECT * FROM "Order" WHERE id = ?`).get(orderId);
  const payment = db.prepare(`SELECT * FROM Payment WHERE orderId = ?`).get(orderId);

  res.status(201).json({
    order: attachLockedOrderMoney({ ...(order as Record<string, unknown>), payment }),
    huaweiProductId: `order_${orderId}`,
    message: "أكمل الدفع عبر Huawei IAP",
  });
});

router.get("/my", authMiddleware(["CUSTOMER"]), (req, res) => {
  const filter = typeof req.query.filter === "string" ? req.query.filter : "active";
  let sql = `SELECT * FROM "Order" WHERE customerId = ? AND COALESCE(hiddenByCustomer, 0) = 0`;
  if (filter === "active") {
    sql += ` AND status IN ('PAID','PREPARING','READY_FOR_PICKUP','CAPTAIN_ASSIGNED','PICKED_UP','DELIVERING')`;
  } else if (filter === "history") {
    sql += ` AND status = 'DELIVERED'`;
  }
  sql += ` ORDER BY createdAt DESC`;

  const orders = db.prepare(sql).all(req.user!.sub) as Record<string, unknown>[];

  const enriched = orders.map((o) => {
    const row = o as { id: string; captainId: string | null };
    return attachLockedOrderMoney({
      ...o,
      items: db
        .prepare(
          `SELECT oi.*, p.name as productName, r.name as restaurantName
           FROM OrderItem oi JOIN Product p ON p.id = oi.productId JOIN Restaurant r ON r.id = oi.restaurantId
           WHERE oi.orderId = ?`
        )
        .all(row.id),
      payment: db.prepare(`SELECT * FROM Payment WHERE orderId = ?`).get(row.id),
      captain: row.captainId ? getCaptainPublicProfile(row.captainId) : null,
    });
  });

  res.json({ orders: enriched });
});

router.delete("/:id", authMiddleware(["CUSTOMER"]), (req, res) => {
  const order = db
    .prepare(`SELECT id, status, customerId FROM "Order" WHERE id = ? AND customerId = ?`)
    .get(req.params.id, req.user!.sub) as { id: string; status: string } | undefined;

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  if (order.status !== "DELIVERED") {
    res.status(400).json({ error: "يمكن حذف الطلبات المستلمة فقط" });
    return;
  }

  db.prepare(`UPDATE "Order" SET hiddenByCustomer = 1, updatedAt = datetime('now') WHERE id = ?`).run(
    req.params.id
  );

  res.json({ ok: true, message: "تم حذف الطلب من قائمتك" });
});

router.get("/restaurant/stats", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare(`SELECT id FROM Restaurant WHERE userId = ?`).get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const period = typeof req.query.period === "string" ? req.query.period : "all";
  const { sql: periodClause, params: periodParams } = periodSql("o.createdAt", {
    period,
    month: req.query.month,
    year: req.query.year,
    date: req.query.date,
  });

  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT o.id) as orderCount, COALESCE(SUM(CAST(oi.lineTotal AS REAL)), 0) as totalAmount
       FROM "Order" o
       JOIN OrderItem oi ON oi.orderId = o.id
       WHERE oi.restaurantId = ? AND o.status NOT IN ('PENDING_PAYMENT', 'CANCELLED')${periodClause}`
    )
    .get(restaurant.id, ...periodParams) as { orderCount: number; totalAmount: number };

  res.json({
    period,
    orderCount: Number(row.orderCount) || 0,
    totalAmount: roundMoney(row.totalAmount),
  });
});

router.get("/restaurant/incoming", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare(`SELECT id FROM Restaurant WHERE userId = ?`).get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const filter = typeof req.query.filter === "string" ? req.query.filter : "active";
  /** نشطة: كل ما لم يُسلَّم بعد — يظهر للمطعم حتى مع الكابتن */
  const activeStatuses =
    "('PAID','PREPARING','READY_FOR_PICKUP','CAPTAIN_ASSIGNED','PICKED_UP','DELIVERING')";
  const completedStatuses = "('DELIVERED')";
  const statusIn = filter === "completed" ? completedStatuses : activeStatuses;

  const orders = db
    .prepare(
      `SELECT DISTINCT o.* FROM "Order" o
       JOIN OrderItem oi ON oi.orderId = o.id
       WHERE oi.restaurantId = ? AND o.status IN ${statusIn}
       ORDER BY o.updatedAt DESC, o.createdAt DESC`
    )
    .all(restaurant.id);

  const enriched = orders.map((o) =>
    enrichRestaurantOrder(o as { id: string; customerId: string }, restaurant.id)
  );

  res.json({ orders: enriched });
});

router.patch("/restaurant/:orderId/status", authMiddleware(["RESTAURANT"]), (req, res) => {
  const { status } = req.body as { status?: string };
  const allowed = ["PREPARING", "READY_FOR_PICKUP", "PICKED_UP"];
  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: "حالة غير صالحة" });
    return;
  }

  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const order = db
    .prepare(
      `SELECT o.id, o.status, o.captainId FROM "Order" o
       WHERE o.id = ? AND EXISTS (
         SELECT 1 FROM OrderItem oi WHERE oi.orderId = o.id AND oi.restaurantId = ?
       )`
    )
    .get(req.params.orderId, restaurant.id) as
    | { id: string; status: string; captainId: string | null }
    | undefined;

  if (!order) {
    res.status(404).json({ error: "الطلب لا يخص مطعمك" });
    return;
  }

  if (status === "PREPARING" && order.status !== "PAID") {
    res.status(400).json({ error: "يمكن بدء التحضير فقط للطلبات المدفوعة" });
    return;
  }
  if (status === "READY_FOR_PICKUP" && order.status !== "PREPARING") {
    res.status(400).json({ error: "يجب بدء التحضير أولاً ثم تعليم الطلب جاهزاً" });
    return;
  }
  if (status === "PICKED_UP") {
    if (!order.captainId) {
      res.status(400).json({ error: "لم يُعيَّن كابتن بعد" });
      return;
    }
    if (!["PAID", "PREPARING", "READY_FOR_PICKUP", "CAPTAIN_ASSIGNED"].includes(order.status)) {
      res.status(400).json({ error: "لا يمكن التسليم في هذه المرحلة" });
      return;
    }
  }

  if (status === "PICKED_UP") {
    db.prepare(
      `UPDATE "Order" SET status = ?, updatedAt = datetime('now'), pickedUpAt = datetime('now') WHERE id = ?`
    ).run(status, req.params.orderId);
  } else {
    db.prepare(`UPDATE "Order" SET status = ?, updatedAt = datetime('now') WHERE id = ?`).run(
      status,
      req.params.orderId
    );
  }

  if (status === "READY_FOR_PICKUP") {
    notifyCaptainsOrderReady(req.params.orderId);
  }

  if (status === "PICKED_UP") {
    getIo()?.to(`order:${req.params.orderId}`).emit("order:status", {
      orderId: req.params.orderId,
      status: "PICKED_UP",
    });
  }

  notifyRestaurantOrderUpdate(req.params.orderId);
  notifyCaptainsOrderUpdate(req.params.orderId);

  const updated = db.prepare(`SELECT * FROM "Order" WHERE id = ?`).get(req.params.orderId);
  res.json({ order: updated });
});

router.get("/captain/available", authMiddleware(["CAPTAIN"]), (_req, res) => {
  res.json({ orders: [] });
});

router.get("/captain/offer", authMiddleware(["CAPTAIN"]), (req, res) => {
  const captain = getOrCreateCaptain(req.user!.sub);
  const rows = findVisibleOffersForCaptain(captain.id);

  const offers = rows.map((row) => {
    const nextAdvanceAt = row.offerExpiresAt as string | null;
    const advanceMs = nextAdvanceAt ? new Date(nextAdvanceAt).getTime() : 0;
    const prioritySecondsLeft =
      nextAdvanceAt && Number.isFinite(advanceMs)
        ? Math.max(0, Math.ceil((advanceMs - Date.now()) / 1000))
        : 0;

    return {
      offer: enrichCaptainOrder(row as { id: string; customerId: string }),
      expiresAt: nextAdvanceAt,
      secondsLeft: prioritySecondsLeft,
      offerSeconds: DISPATCH_OFFER_SECONDS,
      canAcceptAnytime: true,
    };
  });

  res.json({
    offers,
    offer: offers[0]?.offer ?? null,
    offerSeconds: DISPATCH_OFFER_SECONDS,
    canAcceptAnytime: true,
  });
});

router.post("/captain/:orderId/accept", authMiddleware(["CAPTAIN"]), (req, res) => {
  const captain = getOrCreateCaptain(req.user!.sub);

  const existing = db
    .prepare(`SELECT id, status FROM "Order" WHERE id = ? AND captainId IS NULL`)
    .get(req.params.orderId) as { id: string; status: string } | undefined;

  if (!existing || !["PAID", "PREPARING", "READY_FOR_PICKUP"].includes(existing.status)) {
    res.status(409).json({ error: "الطلب غير متاح أو تم قبوله من كابتن آخر" });
    return;
  }

  const acceptCheck = captainCanAcceptOrder(req.params.orderId, captain.id);
  if (!acceptCheck.ok) {
    res.status(409).json({ error: acceptCheck.error });
    return;
  }

  completeDispatchAccept(req.params.orderId, captain.id);

  db.prepare(`UPDATE "Order" SET captainId = ?, updatedAt = datetime('now') WHERE id = ?`).run(
    captain.id,
    req.params.orderId
  );

  getIo()?.to(`order:${req.params.orderId}`).emit("order:status", {
    orderId: req.params.orderId,
    status: existing.status,
    captain: getCaptainPublicProfile(captain.id),
  });

  notifyRestaurantOrderUpdate(req.params.orderId);
  notifyCaptainsOrderUpdate(req.params.orderId);

  const order = db.prepare(`SELECT * FROM "Order" WHERE id = ?`).get(req.params.orderId);
  res.json({ order, message: "تم قبول الطلب — توجه للمطعم" });
});

router.post("/captain/:orderId/reject", authMiddleware(["CAPTAIN"]), (req, res) => {
  const captain = getOrCreateCaptain(req.user!.sub);

  const existing = db
    .prepare(`SELECT id, status, captainId FROM "Order" WHERE id = ?`)
    .get(req.params.orderId) as { id: string; status: string; captainId: string | null } | undefined;

  if (!existing || existing.captainId) {
    res.status(409).json({ error: "الطلب غير متاح" });
    return;
  }

  const acceptCheck = captainCanAcceptOrder(req.params.orderId, captain.id);
  if (!acceptCheck.ok) {
    res.status(409).json({ error: acceptCheck.error });
    return;
  }

  rejectDispatchOffer(req.params.orderId, captain.id);
  res.json({ ok: true, message: "تم الرفض — سيُعرض على الكابتن التالي" });
});

router.get("/captain/stats", authMiddleware(["CAPTAIN"]), (req, res) => {
  const captain = getOrCreateCaptain(req.user!.sub);
  const period = typeof req.query.period === "string" ? req.query.period : "all";
  const { sql: periodClause, params: periodParams } = periodSql("updatedAt", {
    period,
    month: req.query.month,
    year: req.query.year,
    date: req.query.date,
  });

  const row = db
    .prepare(
      `SELECT COUNT(*) as deliveredCount, COALESCE(SUM(CAST(deliveryFee AS REAL)), 0) as totalDeliveryFees
       FROM "Order"
       WHERE captainId = ? AND status = 'DELIVERED' AND COALESCE(hiddenByCaptain, 0) = 0${periodClause}`
    )
    .get(captain.id, ...periodParams) as {
    deliveredCount: number;
    totalDeliveryFees: number;
  };

  res.json({
    period,
    deliveredCount: Number(row.deliveredCount) || 0,
    totalDeliveryFees: roundMoney(row.totalDeliveryFees),
  });
});

router.get("/captain/active", authMiddleware(["CAPTAIN"]), (req, res) => {
  const captain = getOrCreateCaptain(req.user!.sub);
  const orders = db
    .prepare(
      `SELECT * FROM "Order"
       WHERE captainId = ? AND status IN ('PAID','PREPARING','READY_FOR_PICKUP','CAPTAIN_ASSIGNED','PICKED_UP','DELIVERING')
       ORDER BY updatedAt DESC, createdAt DESC`
    )
    .all(captain.id);

  res.json({ orders: orders.map((o) => enrichCaptainOrder(o as { id: string; customerId: string })) });
});

router.get("/captain/completed", authMiddleware(["CAPTAIN"]), (req, res) => {
  const captain = getOrCreateCaptain(req.user!.sub);
  const orders = db
    .prepare(
      `SELECT * FROM "Order"
       WHERE captainId = ? AND status = 'DELIVERED' AND COALESCE(hiddenByCaptain, 0) = 0
       ORDER BY updatedAt DESC, createdAt DESC`
    )
    .all(captain.id);

  res.json({ orders: orders.map((o) => enrichCaptainOrder(o as { id: string; customerId: string })) });
});

router.delete("/captain/:orderId", authMiddleware(["CAPTAIN"]), (req, res) => {
  const captain = getOrCreateCaptain(req.user!.sub);
  const order = db
    .prepare(`SELECT id, status FROM "Order" WHERE id = ? AND captainId = ?`)
    .get(req.params.orderId, captain.id) as { id: string; status: string } | undefined;

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود أو لا يخصك" });
    return;
  }

  if (order.status !== "DELIVERED") {
    res.status(400).json({ error: "يمكن حذف الطلبات المُسلَّمة فقط" });
    return;
  }

  db.prepare(`UPDATE "Order" SET hiddenByCaptain = 1, updatedAt = datetime('now') WHERE id = ?`).run(
    req.params.orderId
  );

  res.json({ ok: true, message: "تم حذف الطلب من قائمتك" });
});

router.patch("/captain/:orderId/status", authMiddleware(["CAPTAIN"]), (req, res) => {
  const { status } = req.body as { status?: string };
  const allowedNext: Record<string, string[]> = {
    PICKED_UP: ["DELIVERING"],
    DELIVERING: ["DELIVERED"],
  };

  if (!status || !["DELIVERING", "DELIVERED"].includes(status)) {
    res.status(400).json({ error: "حالة غير صالحة" });
    return;
  }

  const captain = getOrCreateCaptain(req.user!.sub);
  const order = db
    .prepare(`SELECT * FROM "Order" WHERE id = ? AND captainId = ?`)
    .get(req.params.orderId, captain.id) as { id: string; status: string } | undefined;

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود أو لا يخصك" });
    return;
  }

  if (!allowedNext[order.status]?.includes(status)) {
    res.status(400).json({ error: "لا يمكن الانتقال لهذه الحالة الآن" });
    return;
  }

  if (status === "DELIVERED") {
    db.prepare(
      `UPDATE "Order" SET status = ?, updatedAt = datetime('now'), deliveredAt = datetime('now') WHERE id = ?`
    ).run(status, req.params.orderId);
  } else {
    db.prepare(`UPDATE "Order" SET status = ?, updatedAt = datetime('now') WHERE id = ?`).run(
      status,
      req.params.orderId
    );
  }

  getIo()?.to(`order:${req.params.orderId}`).emit("order:status", {
    orderId: req.params.orderId,
    status,
  });

  notifyRestaurantOrderUpdate(req.params.orderId);

  const updated = db.prepare(`SELECT * FROM "Order" WHERE id = ?`).get(req.params.orderId);
  res.json({ order: updated });
});

router.get("/:id/invoice", authMiddleware(["CUSTOMER"]), (req, res) => {
  const order = db
    .prepare(`SELECT * FROM "Order" WHERE id = ? AND customerId = ?`)
    .get(req.params.id, req.user!.sub) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const items = db
    .prepare(
      `SELECT oi.quantity, oi.unitPrice, oi.lineTotal, p.name as productName, r.name as restaurantName
       FROM OrderItem oi
       JOIN Product p ON p.id = oi.productId
       JOIN Restaurant r ON r.id = oi.restaurantId
       WHERE oi.orderId = ?
       ORDER BY r.name ASC, p.name ASC`
    )
    .all(req.params.id);

  const locked = attachLockedOrderMoney(order);
  res.json({
    orderId: locked.id,
    invoiceNumber: (locked.invoiceNumber as string | null) ?? null,
    status: locked.status,
    createdAt: locked.createdAt,
    deliveryAddress: locked.deliveryAddress,
    subtotal: locked.subtotal,
    deliveryFee: locked.deliveryFee,
    total: locked.total,
    items,
  });
});

router.get("/:id/track", authMiddleware(["CUSTOMER"]), (req, res) => {
  const order = db
    .prepare(`SELECT * FROM "Order" WHERE id = ? AND customerId = ?`)
    .get(req.params.id, req.user!.sub) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const captain = order.captainId ? getCaptainPublicProfile(order.captainId as string) : null;

  const restaurants = db
    .prepare(
      `SELECT DISTINCT r.id, r.name, r.lat, r.lng
       FROM OrderItem oi JOIN Restaurant r ON r.id = oi.restaurantId WHERE oi.orderId = ?`
    )
    .all(req.params.id);

  res.json({
    orderId: order.id,
    invoiceNumber: (order.invoiceNumber as string | null) ?? null,
    status: order.status,
    captain,
    restaurants,
    delivery: {
      lat: order.deliveryLat,
      lng: order.deliveryLng,
      address: order.deliveryAddress,
    },
  });
});

function getCaptainPublicProfile(captainId: string) {
  const row = db
    .prepare(
      `SELECT c.id, c.lat, c.lng, c.updatedAt, c.vehicle, u.name, u.phone
       FROM Captain c JOIN User u ON u.id = c.userId WHERE c.id = ?`
    )
    .get(captainId) as
    | {
        id: string;
        lat: number | null;
        lng: number | null;
        updatedAt: string;
        vehicle: string | null;
        name: string;
        phone: string | null;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    vehicle: row.vehicle,
    lat: row.lat,
    lng: row.lng,
    updatedAt: row.updatedAt,
  };
}

function enrichRestaurantOrder(
  order: { id: string; customerId: string; captainId?: string | null },
  restaurantId: string
) {
  const captainId = order.captainId ?? null;
  return attachLockedOrderMoney({
    ...order,
    items: db
      .prepare(
        `SELECT oi.*, p.name as productName FROM OrderItem oi JOIN Product p ON p.id = oi.productId WHERE oi.orderId = ? AND oi.restaurantId = ?`
      )
      .all(order.id, restaurantId),
    customer: db.prepare(`SELECT name, phone FROM User WHERE id = ?`).get(order.customerId) as
      | { name: string; phone: string | null }
      | undefined,
    captain: captainId ? getCaptainPublicProfile(captainId) : null,
  });
}

function getOrderPaymentMethod(orderId: string): string | null {
  const row = db
    .prepare(`SELECT paymentMethod FROM Payment WHERE orderId = ? AND status = 'SUCCESS'`)
    .get(orderId) as { paymentMethod: string | null } | undefined;
  return row?.paymentMethod ?? null;
}

function enrichCaptainOrder(order: { id: string; customerId: string }) {
  return attachLockedOrderMoney({
    ...order,
    paymentMethod: getOrderPaymentMethod(order.id),
    items: db
      .prepare(
        `SELECT oi.*, p.name as productName, r.name as restaurantName
         FROM OrderItem oi JOIN Product p ON p.id = oi.productId JOIN Restaurant r ON r.id = oi.restaurantId
         WHERE oi.orderId = ?`
      )
      .all(order.id),
    customer: db.prepare(`SELECT name, phone FROM User WHERE id = ?`).get(order.customerId),
    restaurants: db
      .prepare(
        `SELECT DISTINCT r.id, r.name, r.lat, r.lng
         FROM OrderItem oi JOIN Restaurant r ON r.id = oi.restaurantId
         WHERE oi.orderId = ?`
      )
      .all(order.id),
  });
}

function buildOrderTotals(
  items: { productId: string; quantity: number }[],
  deliveryLat: number,
  deliveryLng: number
) {
  const rate = Number(process.env.DELIVERY_RATE_PER_KM ?? 2.5);
  const minFee = Number(process.env.DELIVERY_MIN_FEE ?? 5);

  const productIds = items.map((i) => i.productId);
  const placeholders = productIds.map(() => "?").join(",");
  const products = db
    .prepare(
      `SELECT p.*, r.id as restaurantId, r.lat, r.lng FROM Product p JOIN Restaurant r ON r.id = p.restaurantId
       WHERE p.id IN (${placeholders}) AND p.isAvailable = 1`
    )
    .all(...productIds) as {
    id: string;
    price: number;
    restaurantId: string;
    lat: number;
    lng: number;
  }[];

  if (products.length !== productIds.length) {
    return { error: "بعض المنتجات غير متوفرة" as const };
  }

  const lineItems: {
    restaurantId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[] = [];

  let subtotal = 0;
  const restaurantMap = new Map<string, { lat: number; lng: number }>();

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId)!;
    const unitPrice = effectiveUnitPrice(product.id, product.price);
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    restaurantMap.set(product.restaurantId, { lat: product.lat, lng: product.lng });
    lineItems.push({
      restaurantId: product.restaurantId,
      productId: product.id,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    });
  }

  const deliveryFee = capDeliveryFee(
    calcDeliveryFee([...restaurantMap.values()], deliveryLat, deliveryLng, rate, minFee)
  );
  const total = Math.round((subtotal + deliveryFee) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    deliveryFee,
    total,
    lineItems,
  };
}

export default router;
