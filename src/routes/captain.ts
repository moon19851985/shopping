import { Router } from "express";
import { db } from "../db.js";
import { authMiddleware } from "../lib/auth.js";
import { getOrCreateCaptain } from "../lib/captain.js";
import { resumePendingDispatches } from "../lib/captainDispatch.js";

const router = Router();

router.patch("/location", authMiddleware(["CAPTAIN"]), (req, res) => {
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({ error: "الإحداثيات مطلوبة" });
    return;
  }

  getOrCreateCaptain(req.user!.sub);

  db.prepare(
    `UPDATE Captain SET lat = ?, lng = ?, isOnline = 1, updatedAt = datetime('now') WHERE userId = ?`
  ).run(lat, lng, req.user!.sub);

  resumePendingDispatches();

  const captain = db.prepare("SELECT id, lat, lng FROM Captain WHERE userId = ?").get(req.user!.sub);
  res.json({ captain });
});

router.patch("/online", authMiddleware(["CAPTAIN"]), (req, res) => {
  const { isOnline } = req.body as { isOnline?: boolean };
  getOrCreateCaptain(req.user!.sub);
  db.prepare(`UPDATE Captain SET isOnline = ?, updatedAt = datetime('now') WHERE userId = ?`).run(
    isOnline ? 1 : 0,
    req.user!.sub
  );
  if (isOnline) resumePendingDispatches();
  res.json({ isOnline: Boolean(isOnline) });
});

router.patch("/push-token", authMiddleware(["CAPTAIN"]), (req, res) => {
  const { pushToken } = req.body as { pushToken?: string };
  if (typeof pushToken !== "string" || pushToken.length < 10) {
    res.status(400).json({ error: "رمز الإشعار غير صالح" });
    return;
  }

  getOrCreateCaptain(req.user!.sub);
  db.prepare(`UPDATE Captain SET pushToken = ?, updatedAt = datetime('now') WHERE userId = ?`).run(
    pushToken,
    req.user!.sub
  );
  res.json({ ok: true });
});

router.delete("/push-token", authMiddleware(["CAPTAIN"]), (req, res) => {
  db.prepare(`UPDATE Captain SET pushToken = NULL, updatedAt = datetime('now') WHERE userId = ?`).run(
    req.user!.sub
  );
  res.json({ ok: true });
});

router.get("/status", authMiddleware(["CAPTAIN"]), (req, res) => {
  const captain = db
    .prepare(`SELECT id, isOnline, lat, lng, updatedAt FROM Captain WHERE userId = ?`)
    .get(req.user!.sub) as
    | {
        id: string;
        isOnline: number;
        lat: number | null;
        lng: number | null;
        updatedAt: string;
      }
    | undefined;

  if (!captain) {
    res.json({ isOnline: false, hasLocation: false });
    return;
  }

  res.json({
    isOnline: Boolean(captain.isOnline),
    hasLocation: captain.lat != null && captain.lng != null,
    updatedAt: captain.updatedAt,
  });
});

export default router;
