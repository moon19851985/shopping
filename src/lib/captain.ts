import { db, cuid } from "../db.js";

export function getOrCreateCaptain(userId: string): { id: string } {
  const existing = db.prepare("SELECT id FROM Captain WHERE userId = ?").get(userId) as
    | { id: string }
    | undefined;
  if (existing) return existing;

  const id = cuid();
  db.prepare(`INSERT INTO Captain (id, userId, isOnline) VALUES (?, ?, 1)`).run(id, userId);
  return { id };
}
