import { Router } from "express";
import { db } from "../db.js";
import { authMiddleware } from "../lib/auth.js";

const router = Router();

router.get("/restaurants", authMiddleware(["CUSTOMER"]), (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.description, r.logoUrl, r.address, f.createdAt
       FROM FavoriteRestaurant f
       JOIN Restaurant r ON r.id = f.restaurantId
       WHERE f.userId = ? AND r.isActive = 1
       ORDER BY f.createdAt DESC`
    )
    .all(req.user!.sub);

  res.json({ favorites: rows });
});

router.get("/restaurants/ids", authMiddleware(["CUSTOMER"]), (req, res) => {
  const rows = db
    .prepare(`SELECT restaurantId FROM FavoriteRestaurant WHERE userId = ?`)
    .all(req.user!.sub) as { restaurantId: string }[];

  res.json({ ids: rows.map((r) => r.restaurantId) });
});

router.post("/restaurants/:restaurantId", authMiddleware(["CUSTOMER"]), (req, res) => {
  const restaurant = db
    .prepare(`SELECT id FROM Restaurant WHERE id = ? AND isActive = 1`)
    .get(req.params.restaurantId);

  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  db.prepare(
    `INSERT OR IGNORE INTO FavoriteRestaurant (userId, restaurantId) VALUES (?, ?)`
  ).run(req.user!.sub, req.params.restaurantId);

  res.status(201).json({ ok: true });
});

router.delete("/restaurants/:restaurantId", authMiddleware(["CUSTOMER"]), (req, res) => {
  db.prepare(`DELETE FROM FavoriteRestaurant WHERE userId = ? AND restaurantId = ?`).run(
    req.user!.sub,
    req.params.restaurantId
  );
  res.json({ ok: true });
});

export default router;
