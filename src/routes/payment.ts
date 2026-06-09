import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { authMiddleware } from "../lib/auth.js";
import { sendPaymentReceipt } from "../lib/email.js";
import { notifyOrderPaid } from "../lib/notify.js";
import { assignInvoiceNumber } from "../lib/invoice.js";

const router = Router();

const mockPaySchema = z.object({
  orderId: z.string(),
  method: z.enum(["VISA", "MADA", "COD"]),
});

/** دفع وهمي — Visa أو مدى، أو تأكيد دفع عند الاستلام */
router.post("/mock", authMiddleware(["CUSTOMER"]), async (req, res) => {
  const parsed = mockPaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات الدفع غير صالحة" });
    return;
  }

  const { orderId, method } = parsed.data;

  const order = db
    .prepare(
      `SELECT o.*, u.name as customerName, u.email as customerEmail, p.status as paymentStatus
       FROM "Order" o
       JOIN User u ON u.id = o.customerId
       LEFT JOIN Payment p ON p.orderId = o.id
       WHERE o.id = ? AND o.customerId = ?`
    )
    .get(orderId, req.user!.sub) as
    | {
        id: string;
        status: string;
        subtotal: number;
        deliveryFee: number;
        total: number;
        deliveryAddress: string;
        customerName: string;
        customerEmail: string;
        paymentStatus: string | null;
      }
    | undefined;

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  if (order.paymentStatus === "SUCCESS") {
    res.json({ ok: true, message: "تم الدفع مسبقاً", orderId });
    return;
  }

  if (order.status !== "PENDING_PAYMENT") {
    res.status(400).json({ error: "الطلب غير قابل للدفع" });
    return;
  }

  // محاكاة معالجة الدفع (دائماً ناجحة في وضع التجربة)
  await new Promise((r) => setTimeout(r, 800));

  const isCod = method === "COD";
  const transactionId = isCod
    ? `COD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    : `TXN-${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const paidAt = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });

  let invoiceNumber = "";
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE Payment SET status = 'SUCCESS', provider = ?, paymentMethod = ?, transactionId = ?, verifiedAt = datetime('now') WHERE orderId = ?`
    ).run(isCod ? "COD" : "MOCK", method, transactionId, orderId);
    db.prepare(`UPDATE "Order" SET status = 'PAID', updatedAt = datetime('now') WHERE id = ?`).run(orderId);
    invoiceNumber = assignInvoiceNumber(orderId);
  });
  tx();

  const items = db
    .prepare(
      `SELECT oi.quantity, oi.lineTotal, p.name as productName, r.name as restaurantName
       FROM OrderItem oi
       JOIN Product p ON p.id = oi.productId
       JOIN Restaurant r ON r.id = oi.restaurantId
       WHERE oi.orderId = ?`
    )
    .all(orderId) as {
    quantity: number;
    lineTotal: number;
    productName: string;
    restaurantName: string;
  }[];

  try {
    await sendPaymentReceipt({
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      orderId,
      invoiceNumber,
      transactionId,
      paymentMethod: method,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      deliveryAddress: order.deliveryAddress,
      items: items.map((i) => ({
        name: i.productName,
        restaurantName: i.restaurantName,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
      })),
      paidAt,
    });
  } catch (e) {
    console.error("فشل إرسال الإيصال:", e);
  }

  notifyOrderPaid(orderId);

  res.json({
    ok: true,
    status: "PAID",
    orderId,
    invoiceNumber,
    transactionId,
    paymentMethod: method,
    message: isCod
      ? "تم تأكيد الطلب — ادفع عند الاستلام. أُرسل التأكيد إلى بريدك"
      : "تم الدفع بنجاح — أُرسل الإيصال إلى بريدك",
  });
});

const verifySchema = z.object({
  orderId: z.string(),
  huaweiPurchaseId: z.string(),
  huaweiProductId: z.string(),
  purchaseToken: z.string().optional(),
});

router.post("/huawei/verify", authMiddleware(["CUSTOMER"]), (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { orderId, huaweiPurchaseId, huaweiProductId } = parsed.data;

  const order = db
    .prepare(`SELECT o.id, p.status as paymentStatus FROM "Order" o LEFT JOIN Payment p ON p.orderId = o.id WHERE o.id = ? AND o.customerId = ?`)
    .get(orderId, req.user!.sub) as { id: string; paymentStatus: string | null } | undefined;

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  if (order.paymentStatus === "SUCCESS") {
    res.json({ ok: true, message: "تم الدفع مسبقاً" });
    return;
  }

  let invoiceNumber = "";
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE Payment SET status = 'SUCCESS', huaweiPurchaseId = ?, huaweiProductId = ?, verifiedAt = datetime('now') WHERE orderId = ?`
    ).run(huaweiPurchaseId, huaweiProductId, orderId);
    db.prepare(`UPDATE "Order" SET status = 'PAID', updatedAt = datetime('now') WHERE id = ?`).run(orderId);
    invoiceNumber = assignInvoiceNumber(orderId);
  });
  tx();

  notifyOrderPaid(orderId);

  res.json({ ok: true, status: "PAID", invoiceNumber });
});

export default router;
