import { Router } from "express";
import { z } from "zod";
import { db, cuid } from "../db.js";
import { authMiddleware } from "../lib/auth.js";
import { roundMoney } from "../lib/orderFees.js";

const router = Router();

const paidOrderFilter = `o.status NOT IN ('PENDING_PAYMENT', 'CANCELLED')
  AND EXISTS (SELECT 1 FROM Payment p WHERE p.orderId = o.id AND p.status = 'SUCCESS')`;

function getFinanceSummary() {
  const collected = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(o.total AS REAL)), 0) as v FROM "Order" o WHERE ${paidOrderFilter}`
    )
    .get() as { v: number };

  const restaurantOwed = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(oi.lineTotal AS REAL)), 0) as v
       FROM OrderItem oi
       JOIN "Order" o ON o.id = oi.orderId
       WHERE ${paidOrderFilter}`
    )
    .get() as { v: number };

  const captainOwed = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(o.deliveryFee AS REAL)), 0) as v
       FROM "Order" o
       WHERE o.status = 'DELIVERED' AND o.captainId IS NOT NULL
         AND EXISTS (SELECT 1 FROM Payment p WHERE p.orderId = o.id AND p.status = 'SUCCESS')`
    )
    .get() as { v: number };

  const restaurantPaid = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as v FROM PayoutRecord WHERE type = 'RESTAURANT'`
    )
    .get() as { v: number };

  const captainPaid = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as v FROM PayoutRecord WHERE type = 'CAPTAIN'`
    )
    .get() as { v: number };

  const collectedN = roundMoney(collected.v);
  const restOwedN = roundMoney(restaurantOwed.v);
  const capOwedN = roundMoney(captainOwed.v);
  const restPaidN = roundMoney(restaurantPaid.v);
  const capPaidN = roundMoney(captainPaid.v);

  return {
    collected: collectedN,
    restaurantOwed: restOwedN,
    restaurantPaid: restPaidN,
    restaurantPending: roundMoney(restOwedN - restPaidN),
    captainOwed: capOwedN,
    captainPaid: capPaidN,
    captainPending: roundMoney(capOwedN - capPaidN),
    platformHeld: roundMoney(collectedN - restOwedN - capOwedN),
    platformAfterPayouts: roundMoney(collectedN - restPaidN - capPaidN),
  };
}

router.get("/overview", authMiddleware(["ADMIN"]), (_req, res) => {
  const users = db
    .prepare(
      `SELECT role, COUNT(*) as n FROM User WHERE role != 'ADMIN' GROUP BY role`
    )
    .all() as { role: string; n: number }[];

  const orderStats = db
    .prepare(
      `SELECT
         COUNT(*) as totalOrders,
         SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) as delivered
       FROM "Order" o WHERE ${paidOrderFilter}`
    )
    .get() as { totalOrders: number; delivered: number };

  const counts: Record<string, number> = {};
  for (const row of users) counts[row.role] = Number(row.n);

  res.json({
    users: {
      customers: counts.CUSTOMER ?? 0,
      restaurants: counts.RESTAURANT ?? 0,
      captains: counts.CAPTAIN ?? 0,
    },
    orders: {
      paid: Number(orderStats?.totalOrders) || 0,
      delivered: Number(orderStats?.delivered) || 0,
    },
    finance: getFinanceSummary(),
  });
});

router.get("/restaurants", authMiddleware(["ADMIN"]), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.city, r.address, r.isActive, u.email, u.phone, u.createdAt,
        COALESCE((
          SELECT SUM(CAST(oi.lineTotal AS REAL))
          FROM OrderItem oi
          JOIN "Order" o ON o.id = oi.orderId
          WHERE oi.restaurantId = r.id AND ${paidOrderFilter}
        ), 0) as salesTotal,
        COALESCE((
          SELECT COUNT(DISTINCT o.id)
          FROM OrderItem oi
          JOIN "Order" o ON o.id = oi.orderId
          WHERE oi.restaurantId = r.id AND ${paidOrderFilter}
        ), 0) as orderCount,
        COALESCE((
          SELECT SUM(CAST(pr.amount AS REAL))
          FROM PayoutRecord pr WHERE pr.type = 'RESTAURANT' AND pr.beneficiaryId = r.id
        ), 0) as paidOut
       FROM Restaurant r
       JOIN User u ON u.id = r.userId
       ORDER BY salesTotal DESC`
    )
    .all() as Record<string, unknown>[];

  res.json({
    restaurants: rows.map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      address: r.address,
      isActive: Boolean(r.isActive),
      email: r.email,
      phone: r.phone,
      createdAt: r.createdAt,
      orderCount: Number(r.orderCount) || 0,
      salesTotal: roundMoney(r.salesTotal),
      paidOut: roundMoney(r.paidOut),
      pending: roundMoney(Number(r.salesTotal) - Number(r.paidOut)),
    })),
  });
});

router.get("/captains", authMiddleware(["ADMIN"]), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.vehicle, c.isOnline, c.lat, c.lng, u.name, u.email, u.phone, u.createdAt,
        COALESCE((
          SELECT COUNT(*) FROM "Order" o
          WHERE o.captainId = c.id AND o.status = 'DELIVERED'
            AND EXISTS (SELECT 1 FROM Payment p WHERE p.orderId = o.id AND p.status = 'SUCCESS')
        ), 0) as deliveredCount,
        COALESCE((
          SELECT SUM(CAST(o.deliveryFee AS REAL)) FROM "Order" o
          WHERE o.captainId = c.id AND o.status = 'DELIVERED'
            AND EXISTS (SELECT 1 FROM Payment p WHERE p.orderId = o.id AND p.status = 'SUCCESS')
        ), 0) as feesTotal,
        COALESCE((
          SELECT SUM(CAST(pr.amount AS REAL))
          FROM PayoutRecord pr WHERE pr.type = 'CAPTAIN' AND pr.beneficiaryId = c.id
        ), 0) as paidOut
       FROM Captain c
       JOIN User u ON u.id = c.userId
       ORDER BY feesTotal DESC`
    )
    .all() as Record<string, unknown>[];

  res.json({
    captains: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      vehicle: r.vehicle,
      isOnline: Boolean(r.isOnline),
      hasLocation: r.lat != null && r.lng != null,
      createdAt: r.createdAt,
      deliveredCount: Number(r.deliveredCount) || 0,
      feesTotal: roundMoney(r.feesTotal),
      paidOut: roundMoney(r.paidOut),
      pending: roundMoney(Number(r.feesTotal) - Number(r.paidOut)),
    })),
  });
});

router.get("/customers", authMiddleware(["ADMIN"]), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.createdAt,
        COALESCE((
          SELECT COUNT(*) FROM "Order" o
          WHERE o.customerId = u.id AND ${paidOrderFilter}
        ), 0) as orderCount,
        COALESCE((
          SELECT SUM(CAST(o.total AS REAL)) FROM "Order" o
          WHERE o.customerId = u.id AND ${paidOrderFilter}
        ), 0) as spentTotal
       FROM User u
       WHERE u.role = 'CUSTOMER'
       ORDER BY spentTotal DESC`
    )
    .all() as Record<string, unknown>[];

  res.json({
    customers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      createdAt: r.createdAt,
      orderCount: Number(r.orderCount) || 0,
      spentTotal: roundMoney(r.spentTotal),
    })),
  });
});

router.get("/payouts", authMiddleware(["ADMIN"]), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT pr.*, 
        CASE WHEN pr.type = 'RESTAURANT' THEN (SELECT name FROM Restaurant WHERE id = pr.beneficiaryId)
             WHEN pr.type = 'CAPTAIN' THEN (SELECT u.name FROM Captain c JOIN User u ON u.id = c.userId WHERE c.id = pr.beneficiaryId)
        END as beneficiaryName
       FROM PayoutRecord pr
       ORDER BY pr.createdAt DESC
       LIMIT 100`
    )
    .all();

  res.json({ payouts: rows });
});

const payoutSchema = z.object({
  type: z.enum(["RESTAURANT", "CAPTAIN"]),
  beneficiaryId: z.string().min(1),
  amount: z.number().positive(),
  note: z.string().optional(),
});

router.post("/payouts", authMiddleware(["ADMIN"]), (req, res) => {
  const parsed = payoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { type, beneficiaryId, amount, note } = parsed.data;

  if (type === "RESTAURANT") {
    const r = db.prepare(`SELECT id FROM Restaurant WHERE id = ?`).get(beneficiaryId);
    if (!r) {
      res.status(404).json({ error: "المطعم غير موجود" });
      return;
    }
  } else {
    const c = db.prepare(`SELECT id FROM Captain WHERE id = ?`).get(beneficiaryId);
    if (!c) {
      res.status(404).json({ error: "الكابتن غير موجود" });
      return;
    }
  }

  const id = cuid();
  db.prepare(
    `INSERT INTO PayoutRecord (id, type, beneficiaryId, amount, note, createdBy) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, type, beneficiaryId, roundMoney(amount), note ?? null, req.user!.sub);

  res.status(201).json({ ok: true, id, message: "تم تسجيل التسليم المالي" });
});

export default router;
