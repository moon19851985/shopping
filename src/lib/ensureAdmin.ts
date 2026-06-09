import bcrypt from "bcryptjs";
import { db, cuid } from "../db.js";

/** حساب مدير واحد — من .env أو القيم الافتراضية للتطوير */
export async function ensureAdminUser() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@gostasrv.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "123456";

  const existing = db.prepare(`SELECT id FROM User WHERE email = ?`).get(email) as
    | { id: string }
    | undefined;

  const passwordHash = await bcrypt.hash(password, 10);

  if (existing) {
    db.prepare(
      `UPDATE User SET role = 'ADMIN', emailVerified = 1, passwordHash = ?, name = 'مدير المنصة' WHERE id = ?`
    ).run(passwordHash, existing.id);
    return;
  }

  db.prepare(
    `INSERT INTO User (id, email, passwordHash, name, phone, role, emailVerified)
     VALUES (?, ?, ?, 'مدير المنصة', NULL, 'ADMIN', 1)`
  ).run(cuid(), email, passwordHash);
}
