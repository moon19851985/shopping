import { db } from "../db.js";

/** يُستدعى عند نجاح الدفع فقط — لا يُنشأ رقم فاتورة قبل ذلك */
export function assignInvoiceNumber(orderId: string): string {
  const existing = db
    .prepare(`SELECT invoiceNumber FROM "Order" WHERE id = ?`)
    .get(orderId) as { invoiceNumber: string | null } | undefined;

  if (existing?.invoiceNumber) {
    return existing.invoiceNumber;
  }

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const row = db
    .prepare(`SELECT COUNT(*) as n FROM "Order" WHERE invoiceNumber IS NOT NULL`)
    .get() as { n: number };
  const seq = Number(row.n) + 1;
  const invoiceNumber = `INV-${date}-${String(seq).padStart(5, "0")}`;

  db.prepare(`UPDATE "Order" SET invoiceNumber = ? WHERE id = ?`).run(invoiceNumber, orderId);
  return invoiceNumber;
}
