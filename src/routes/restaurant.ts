import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db, cuid } from "../db.js";
import { authMiddleware } from "../lib/auth.js";
import { roundMoney } from "../lib/orderFees.js";
import { normalizeImageUrl, publicImageUrl } from "../lib/imageUrl.js";
import {
  OFFER_SLOTS,
  OFFER_SLOT_LABELS,
  parseOfferSlot,
  parseHourMinute,
  validateHourlyRange,
  type OfferSlot,
} from "../lib/offerSlots.js";
import { inferOfferSlotFromProduct, deliveryOfferReason } from "../lib/inferOfferSlot.js";
import { promotionPricing } from "../lib/promotionEnrich.js";
import { enrichComboProduct } from "../lib/comboMeal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.UPLOAD_DIR ?? path.join(__dirname, "../../uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || mimeToExt(file.mimetype);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

function mimeToExt(mime: string) {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  return ".jpg";
}

function isImageFile(file: Express.Multer.File) {
  if (file.mimetype.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp)$/i.test(file.originalname);
}

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!isImageFile(file)) {
      cb(new Error("صورة فقط (jpg, png, webp)"));
      return;
    }
    cb(null, true);
  },
});

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER"] as const;

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  category: z.string().min(1),
  mealType: z.union([z.enum(MEAL_TYPES), z.literal("")]),
});

function parseMealType(raw: unknown, existingMealType?: string): string {
  if (raw === undefined) return existingMealType ?? "";
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!s || s === "NONE" || s === "NULL") return "";
  return MEAL_TYPES.includes(s as (typeof MEAL_TYPES)[number]) ? s : existingMealType ?? "";
}

router.get("/me", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT * FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | Record<string, unknown>
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }
  const allProducts = db
    .prepare("SELECT * FROM Product WHERE restaurantId = ? AND isAvailable = 1")
    .all(restaurant.id as string) as Record<string, unknown>[];

  const products = allProducts
    .filter((p) => !(p.isComboMeal as number))
    .map((p) => ({
      ...p,
      imageUrl: normalizeImageUrl((p as { imageUrl: string | null }).imageUrl),
    }));

  const comboMeals = allProducts
    .filter((p) => !!(p.isComboMeal as number))
    .map((p) => enrichComboProduct(p));

  res.json({
    restaurant: {
      ...restaurant,
      logoUrl: normalizeImageUrl((restaurant.logoUrl as string | null) ?? null),
      products,
      comboMeals,
    },
  });
});

router.patch("/logo", authMiddleware(["RESTAURANT"]), (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message ?? "فشل رفع الصورة" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "اختر صورة الشعار" });
      return;
    }

    const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
      | { id: string }
      | undefined;
    if (!restaurant) {
      res.status(404).json({ error: "المطعم غير موجود" });
      return;
    }

    const logoUrl = publicImageUrl(req.file.filename);
    db.prepare("UPDATE Restaurant SET logoUrl = ? WHERE id = ?").run(logoUrl, restaurant.id);
    res.json({ logoUrl: normalizeImageUrl(logoUrl) });
  });
});

function parseProductBody(req: Express.Request, existingMealType?: string) {
  return {
    name: req.body.name,
    description: req.body.description,
    price: Number(req.body.price),
    category: req.body.category,
    mealType: parseMealType(req.body.mealType, existingMealType),
  };
}

function saveProductHandler(
  req: Express.Request,
  res: Express.Response,
  existing?: Record<string, unknown>
) {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const body = parseProductBody(req, existing?.mealType as string | undefined);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات المنتج غير صالحة" });
    return;
  }

  const imageUrl = req.file
    ? publicImageUrl(req.file.filename)
    : (existing?.imageUrl as string | null | undefined) ?? null;

  if (existing) {
    db.prepare(
      `UPDATE Product SET name = ?, description = ?, price = ?, imageUrl = ?, category = ?, mealType = ?
       WHERE id = ? AND restaurantId = ? AND isAvailable = 1`
    ).run(
      parsed.data.name,
      parsed.data.description ?? null,
      parsed.data.price,
      imageUrl,
      parsed.data.category,
      parsed.data.mealType,
      existing.id as string,
      restaurant.id
    );
    const product = db.prepare("SELECT * FROM Product WHERE id = ?").get(existing.id as string);
    res.json({ product });
    return;
  }

  const id = cuid();
  db.prepare(
    `INSERT INTO Product (id, restaurantId, name, description, price, imageUrl, category, mealType)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    restaurant.id,
    parsed.data.name,
    parsed.data.description ?? null,
    parsed.data.price,
    imageUrl,
    parsed.data.category,
    parsed.data.mealType
  );

  const product = db.prepare("SELECT * FROM Product WHERE id = ?").get(id);
  res.status(201).json({ product });
}

router.post("/products", authMiddleware(["RESTAURANT"]), (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message ?? "فشل رفع الصورة" });
      return;
    }
    saveProductHandler(req, res);
  });
});

router.patch("/products/:id", authMiddleware(["RESTAURANT"]), (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message ?? "فشل رفع الصورة" });
      return;
    }

    const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
      | { id: string }
      | undefined;
    if (!restaurant) {
      res.status(404).json({ error: "المطعم غير موجود" });
      return;
    }

    const existing = db
      .prepare("SELECT * FROM Product WHERE id = ? AND restaurantId = ? AND isAvailable = 1")
      .get(req.params.id, restaurant.id) as Record<string, unknown> | undefined;

    if (!existing) {
      res.status(404).json({ error: "المنتج غير موجود" });
      return;
    }

    saveProductHandler(req, res, existing);
  });
});

router.delete("/products/:id", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const usedInCombo = db
    .prepare(`SELECT 1 FROM ComboItem WHERE componentProductId = ? LIMIT 1`)
    .get(req.params.id);
  if (usedInCombo) {
    res.status(400).json({
      error: "هذا المنتج مكوّن لوجبة مركّبة — احذف الوجبة أو عدّل مكوّناتها أولاً",
    });
    return;
  }

  const result = db
    .prepare("UPDATE Product SET isAvailable = 0 WHERE id = ? AND restaurantId = ? AND isAvailable = 1")
    .run(req.params.id, restaurant.id);

  if (result.changes === 0) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }

  db.prepare("UPDATE Promotion SET isActive = 0 WHERE productId = ? AND restaurantId = ?").run(
    req.params.id,
    restaurant.id
  );

  res.json({ ok: true });
});

const promotionSchema = z.object({
  productId: z.string().min(1),
  discountedPrice: z.number().positive(),
  reason: z.string().min(2).max(120),
  isStarterDeal: z.boolean().optional(),
  offerSlot: z.enum(OFFER_SLOTS),
  hourStart: z.string().optional(),
  hourEnd: z.string().optional(),
});

function enrichRestaurantPromotion(row: {
  id: string;
  restaurantId: string;
  productId: string;
  discountedPrice: number;
  reason: string;
  createdAt: string;
  productName: string;
  originalPrice: number;
  imageUrl: string | null;
  category: string;
  mealType: string;
  restaurantName: string;
  restaurantLogo: string | null;
  isStarterDeal?: number | null;
  offerSlot?: string | null;
  hourStart?: string | null;
  hourEnd?: string | null;
  offerDeliveryFee?: number | null;
}) {
  const pricing = promotionPricing(row);
  return {
    id: row.id,
    productId: row.productId,
    discountedPrice: pricing.discountedPrice,
    originalPrice: pricing.originalPrice,
    savingsPercent: pricing.savingsPercent,
    reason: row.reason,
    createdAt: row.createdAt,
    isStarterDeal: !!row.isStarterDeal,
    offerSlot: pricing.offerSlot ?? null,
    offerDeliveryFee: pricing.offerDeliveryFee,
    hourStart: row.hourStart ?? null,
    hourEnd: row.hourEnd ?? null,
    isHourlyActive: pricing.isHourlyActive,
    product: {
      id: row.productId,
      name: row.productName,
      price: pricing.originalPrice,
      imageUrl: normalizeImageUrl(row.imageUrl),
      category: row.category,
      mealType: row.mealType,
    },
    restaurant: {
      id: row.restaurantId,
      name: row.restaurantName,
      logoUrl: normalizeImageUrl(row.restaurantLogo),
    },
  };
}

const RESTAURANT_PROMOTION_SELECT = `
  SELECT pr.id, pr.restaurantId, pr.productId, pr.discountedPrice, pr.reason, pr.createdAt,
         pr.isStarterDeal, pr.offerSlot, pr.hourStart, pr.hourEnd, pr.offerDeliveryFee,
         p.name as productName, p.price as originalPrice, p.imageUrl, p.category, p.mealType,
         r.name as restaurantName, r.logoUrl as restaurantLogo
  FROM Promotion pr
  JOIN Product p ON p.id = pr.productId
  JOIN Restaurant r ON r.id = pr.restaurantId
  WHERE pr.isActive = 1 AND pr.restaurantId = ?
`;

const deliveryOfferSchema = z.object({
  productId: z.string().min(1),
  offerDeliveryFee: z.coerce.number().min(0),
});

router.post("/delivery-offers", authMiddleware(["RESTAURANT"]), (req, res) => {
  try {
    const parsed = deliveryOfferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "اختر منتجاً وسعر توصيل صالح (0 = مجاني)" });
      return;
    }

    const restaurant = db.prepare("SELECT id, name FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
      | { id: string; name: string }
      | undefined;
    if (!restaurant) {
      res.status(404).json({ error: "المطعم غير موجود" });
      return;
    }

    const product = db
      .prepare(`SELECT * FROM Product WHERE id = ? AND restaurantId = ? AND isAvailable = 1`)
      .get(parsed.data.productId, restaurant.id) as
      | {
          id: string;
          name: string;
          price: number;
          imageUrl: string | null;
          category: string;
          mealType: string;
        }
      | undefined;

    if (!product) {
      res.status(404).json({ error: "المنتج غير موجود أو لا يخص مطعمك" });
      return;
    }

    const offerSlot = inferOfferSlotFromProduct(product.category, product.mealType);
    const offerDeliveryFee = roundMoney(parsed.data.offerDeliveryFee);
    const reason = deliveryOfferReason(offerDeliveryFee);
    const discountedPrice = roundMoney(product.price);

    const existing = db
      .prepare(
        `SELECT id FROM Promotion WHERE productId = ? AND restaurantId = ? AND isActive = 1 LIMIT 1`
      )
      .get(product.id, restaurant.id) as { id: string } | undefined;

    const promotionId = existing?.id ?? cuid();

    if (existing) {
      db.prepare(
        `UPDATE Promotion SET discountedPrice = ?, reason = ?, offerSlot = ?, offerDeliveryFee = ?,
         hourStart = NULL, hourEnd = NULL, isStarterDeal = 0
         WHERE id = ? AND restaurantId = ?`
      ).run(discountedPrice, reason, offerSlot, offerDeliveryFee, promotionId, restaurant.id);
    } else {
      db.prepare(
        `INSERT INTO Promotion (id, restaurantId, productId, discountedPrice, reason, isStarterDeal, offerSlot, hourStart, hourEnd, offerDeliveryFee)
         VALUES (?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?)`
      ).run(
        promotionId,
        restaurant.id,
        product.id,
        discountedPrice,
        reason,
        offerSlot,
        offerDeliveryFee
      );
    }

    const row = db
      .prepare(`${RESTAURANT_PROMOTION_SELECT} AND pr.id = ?`)
      .get(restaurant.id, promotionId) as Parameters<typeof enrichRestaurantPromotion>[0] | undefined;

    if (!row) {
      res.status(500).json({ error: "تم الحفظ لكن تعذّر قراءة العرض — أعد تشغيل الخادم وحاول مرة أخرى" });
      return;
    }

    const slotLabel = OFFER_SLOT_LABELS[offerSlot];
    res.status(existing ? 200 : 201).json({
      promotion: enrichRestaurantPromotion(row),
      message: `تم النشر في «${slotLabel}» — ${reason}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    console.error("[delivery-offers]", e);
    if (msg.includes("offerDeliveryFee")) {
      res.status(500).json({
        error: "عمود offerDeliveryFee غير موجود — أعد تشغيل الخادم (npm run dev) لتحديث قاعدة البيانات",
      });
      return;
    }
    res.status(500).json({ error: `فشل نشر عرض التوصيل: ${msg}` });
  }
});

router.get("/promotions", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const rows = db
    .prepare(`${RESTAURANT_PROMOTION_SELECT} ORDER BY pr.createdAt DESC`)
    .all(restaurant.id) as Parameters<typeof enrichRestaurantPromotion>[0][];

  res.json({ promotions: rows.map(enrichRestaurantPromotion) });
});

router.post("/promotions", authMiddleware(["RESTAURANT"]), (req, res) => {
  const offerSlot = parseOfferSlot(req.body.offerSlot);
  const parsed = promotionSchema.safeParse({
    productId: req.body.productId,
    discountedPrice: Number(req.body.discountedPrice),
    reason: typeof req.body.reason === "string" ? req.body.reason.trim() : "",
    isStarterDeal: req.body.isStarterDeal === true || req.body.isStarterDeal === 1,
    offerSlot: offerSlot ?? req.body.offerSlot,
    hourStart: typeof req.body.hourStart === "string" ? req.body.hourStart.trim() : undefined,
    hourEnd: typeof req.body.hourEnd === "string" ? req.body.hourEnd.trim() : undefined,
  });
  if (!parsed.success || !offerSlot) {
    res.status(400).json({ error: "بيانات العرض غير صالحة — اختر قسم العرض اليومي" });
    return;
  }

  let hourStart: string | null = null;
  let hourEnd: string | null = null;
  if (offerSlot === "HOURLY") {
    hourStart = parseHourMinute(parsed.data.hourStart);
    hourEnd = parseHourMinute(parsed.data.hourEnd);
    if (!hourStart || !hourEnd || !validateHourlyRange(hourStart, hourEnd)) {
      res.status(400).json({ error: "حدّد وقت بداية ونهاية صالحين لعروض الساعة (مثال 14:00 — 17:00)" });
      return;
    }
  }

  const restaurant = db.prepare("SELECT id, name FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string; name: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const product = db
    .prepare(`SELECT * FROM Product WHERE id = ? AND restaurantId = ? AND isAvailable = 1`)
    .get(parsed.data.productId, restaurant.id) as
    | { id: string; name: string; price: number; imageUrl: string | null; category: string; mealType: string }
    | undefined;

  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود أو لا يخص مطعمك" });
    return;
  }

  const offerDeliveryFee =
    req.body.offerDeliveryFee != null && req.body.offerDeliveryFee !== ""
      ? roundMoney(Number(req.body.offerDeliveryFee))
      : null;

  if (parsed.data.discountedPrice >= product.price && offerDeliveryFee == null) {
    res.status(400).json({ error: "سعر العرض يجب أن يكون أقل من السعر الأصلي" });
    return;
  }

  const isStarterDeal = parsed.data.isStarterDeal ? 1 : 0;
  const id = cuid();
  db.prepare(
    `INSERT INTO Promotion (id, restaurantId, productId, discountedPrice, reason, isStarterDeal, offerSlot, hourStart, hourEnd, offerDeliveryFee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    restaurant.id,
    product.id,
    roundMoney(parsed.data.discountedPrice),
    parsed.data.reason,
    isStarterDeal,
    offerSlot,
    hourStart,
    hourEnd,
    offerDeliveryFee
  );

  const row = {
    id,
    restaurantId: restaurant.id,
    productId: product.id,
    discountedPrice: roundMoney(parsed.data.discountedPrice),
    reason: parsed.data.reason,
    createdAt: new Date().toISOString(),
    isStarterDeal,
    offerSlot,
    hourStart,
    hourEnd,
    productName: product.name,
    originalPrice: product.price,
    imageUrl: product.imageUrl,
    category: product.category,
    mealType: product.mealType,
    restaurantName: restaurant.name,
  };

  res.status(201).json({ promotion: enrichRestaurantPromotion(row) });
});

const packageItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1),
});

const packageBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  items: z.array(packageItemSchema).min(1),
});

function parsePackageItems(raw: unknown): { productId: string; quantity: number }[] | null {
  if (Array.isArray(raw)) return raw as { productId: string; quantity: number }[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as { productId: string; quantity: number }[];
    } catch {
      return null;
    }
  }
  return null;
}

function loadRestaurantPackageItems(packageId: string) {
  return db
    .prepare(
      `SELECT pi.id, pi.productId, pi.quantity, p.name as productName, p.price as productPrice
       FROM PackageItem pi
       JOIN Product p ON p.id = pi.productId
       WHERE pi.packageId = ?`
    )
    .all(packageId);
}

function enrichPackageRow(pkg: Record<string, unknown>) {
  const items = loadRestaurantPackageItems(pkg.id as string);
  const originalPrice = roundMoney(
    items.reduce((s, i) => s + Number((i as { productPrice: number }).productPrice) * (i as { quantity: number }).quantity, 0)
  );
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    price: roundMoney(Number(pkg.price)),
    originalPrice: originalPrice > 0 ? originalPrice : undefined,
    imageUrl: normalizeImageUrl(pkg.imageUrl as string | null),
    items,
    createdAt: pkg.createdAt,
  };
}

router.get("/packages", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const rows = db
    .prepare(
      `SELECT * FROM Package WHERE restaurantId = ? AND isActive = 1 ORDER BY createdAt DESC`
    )
    .all(restaurant.id) as Record<string, unknown>[];

  res.json({ packages: rows.map(enrichPackageRow) });
});

router.post("/packages", authMiddleware(["RESTAURANT"]), upload.single("image"), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const itemsRaw = parsePackageItems(req.body.items);
  const parsed = packageBodySchema.safeParse({
    name: req.body.name,
    description: req.body.description,
    price: Number(req.body.price),
    items: itemsRaw ?? [],
  });
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات البكج غير صالحة — اختر منتجاً واحداً على الأقل" });
    return;
  }

  for (const item of parsed.data.items) {
    const product = db
      .prepare(`SELECT id FROM Product WHERE id = ? AND restaurantId = ? AND isAvailable = 1`)
      .get(item.productId, restaurant.id);
    if (!product) {
      res.status(400).json({ error: "أحد المنتجات غير موجود أو لا يخص مطعمك" });
      return;
    }
  }

  const catalogTotal = parsed.data.items.reduce((s, item) => {
    const p = db
      .prepare(`SELECT price FROM Product WHERE id = ?`)
      .get(item.productId) as { price: number };
    return s + p.price * item.quantity;
  }, 0);

  if (parsed.data.price >= catalogTotal) {
    res.status(400).json({ error: "سعر البكج يجب أن يكون أقل من مجموع أسعار المنتجات" });
    return;
  }

  const packageId = cuid();
  const imageUrl = req.file ? publicImageUrl(req.file.filename) : null;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO Package (id, restaurantId, name, description, imageUrl, price) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      packageId,
      restaurant.id,
      parsed.data.name,
      parsed.data.description ?? null,
      imageUrl,
      roundMoney(parsed.data.price)
    );
    const ins = db.prepare(
      `INSERT INTO PackageItem (id, packageId, productId, quantity) VALUES (?, ?, ?, ?)`
    );
    for (const item of parsed.data.items) {
      ins.run(cuid(), packageId, item.productId, item.quantity);
    }
  });
  tx();

  const row = db.prepare(`SELECT * FROM Package WHERE id = ?`).get(packageId) as Record<string, unknown>;
  res.status(201).json({ package: enrichPackageRow(row) });
});

router.put("/packages/:id", authMiddleware(["RESTAURANT"]), upload.single("image"), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const existing = db
    .prepare(`SELECT * FROM Package WHERE id = ? AND restaurantId = ? AND isActive = 1`)
    .get(req.params.id, restaurant.id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: "البكج غير موجود" });
    return;
  }

  const itemsRaw = parsePackageItems(req.body.items);
  const parsed = packageBodySchema.safeParse({
    name: req.body.name,
    description: req.body.description,
    price: Number(req.body.price),
    items: itemsRaw ?? [],
  });
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات البكج غير صالحة" });
    return;
  }

  for (const item of parsed.data.items) {
    const product = db
      .prepare(`SELECT id FROM Product WHERE id = ? AND restaurantId = ? AND isAvailable = 1`)
      .get(item.productId, restaurant.id);
    if (!product) {
      res.status(400).json({ error: "أحد المنتجات غير موجود أو لا يخص مطعمك" });
      return;
    }
  }

  const catalogTotal = parsed.data.items.reduce((s, item) => {
    const p = db
      .prepare(`SELECT price FROM Product WHERE id = ?`)
      .get(item.productId) as { price: number };
    return s + p.price * item.quantity;
  }, 0);

  if (parsed.data.price >= catalogTotal) {
    res.status(400).json({ error: "سعر البكج يجب أن يكون أقل من مجموع أسعار المنتجات" });
    return;
  }

  const imageUrl = req.file
    ? publicImageUrl(req.file.filename)
    : (existing.imageUrl as string | null);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE Package SET name = ?, description = ?, imageUrl = ?, price = ? WHERE id = ?`
    ).run(
      parsed.data.name,
      parsed.data.description ?? null,
      imageUrl,
      roundMoney(parsed.data.price),
      req.params.id
    );
    db.prepare(`DELETE FROM PackageItem WHERE packageId = ?`).run(req.params.id);
    const ins = db.prepare(
      `INSERT INTO PackageItem (id, packageId, productId, quantity) VALUES (?, ?, ?, ?)`
    );
    for (const item of parsed.data.items) {
      ins.run(cuid(), req.params.id, item.productId, item.quantity);
    }
  });
  tx();

  const row = db.prepare(`SELECT * FROM Package WHERE id = ?`).get(req.params.id) as Record<string, unknown>;
  res.json({ package: enrichPackageRow(row) });
});

router.delete("/packages/:id", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const result = db
    .prepare(`UPDATE Package SET isActive = 0 WHERE id = ? AND restaurantId = ?`)
    .run(req.params.id, restaurant.id);

  if (result.changes === 0) {
    res.status(404).json({ error: "البكج غير موجود" });
    return;
  }

  res.json({ ok: true });
});

router.patch("/promotions/:id/starter", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const isStarterDeal = req.body?.isStarterDeal === true || req.body?.isStarterDeal === 1 ? 1 : 0;
  const result = db
    .prepare(
      `UPDATE Promotion SET isStarterDeal = ? WHERE id = ? AND restaurantId = ? AND isActive = 1`
    )
    .run(isStarterDeal, req.params.id, restaurant.id);

  if (result.changes === 0) {
    res.status(404).json({ error: "العرض غير موجود" });
    return;
  }

  const row = db
    .prepare(`${RESTAURANT_PROMOTION_SELECT} AND pr.id = ?`)
    .get(restaurant.id, req.params.id) as Parameters<typeof enrichRestaurantPromotion>[0] | undefined;

  if (!row) {
    res.status(404).json({ error: "العرض غير موجود" });
    return;
  }

  res.json({ promotion: enrichRestaurantPromotion(row) });
});

const comboItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1),
});

const comboBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  category: z.string().min(1).optional(),
  mealType: z.union([z.enum(MEAL_TYPES), z.literal("")]).optional(),
  items: z.array(comboItemSchema).min(1),
});

function parseComboItems(raw: unknown): { productId: string; quantity: number }[] | null {
  if (Array.isArray(raw)) return raw as { productId: string; quantity: number }[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as { productId: string; quantity: number }[];
    } catch {
      return null;
    }
  }
  return null;
}

function validateComboComponents(
  restaurantId: string,
  items: { productId: string; quantity: number }[],
  excludeComboId?: string
) {
  for (const item of items) {
    const product = db
      .prepare(
        `SELECT id, isComboMeal FROM Product WHERE id = ? AND restaurantId = ? AND isAvailable = 1`
      )
      .get(item.productId, restaurantId) as { id: string; isComboMeal: number } | undefined;
    if (!product) {
      return "أحد المنتجات غير موجود أو لا يخص مطعمك";
    }
    if (product.isComboMeal) {
      return "لا يمكن إدراج وجبة مركّبة داخل وجبة أخرى";
    }
    if (excludeComboId && item.productId === excludeComboId) {
      return "لا يمكن أن تتضمن الوجبة نفسها";
    }
  }
  return null;
}

function saveComboItems(comboProductId: string, items: { productId: string; quantity: number }[]) {
  db.prepare(`DELETE FROM ComboItem WHERE comboProductId = ?`).run(comboProductId);
  const ins = db.prepare(
    `INSERT INTO ComboItem (id, comboProductId, componentProductId, quantity) VALUES (?, ?, ?, ?)`
  );
  for (const item of items) {
    ins.run(cuid(), comboProductId, item.productId, item.quantity);
  }
}

router.get("/combo-meals", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const rows = db
    .prepare(
      `SELECT * FROM Product WHERE restaurantId = ? AND isAvailable = 1 AND isComboMeal = 1 ORDER BY createdAt DESC`
    )
    .all(restaurant.id) as Record<string, unknown>[];

  res.json({ comboMeals: rows.map(enrichComboProduct) });
});

router.post("/combo-meals", authMiddleware(["RESTAURANT"]), (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message ?? "فشل رفع الصورة" });
      return;
    }

    const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
      | { id: string }
      | undefined;
    if (!restaurant) {
      res.status(404).json({ error: "المطعم غير موجود" });
      return;
    }

    const itemsRaw = parseComboItems(req.body.items);
    const parsed = comboBodySchema.safeParse({
      name: req.body.name,
      description: req.body.description,
      price: Number(req.body.price),
      category: req.body.category ?? "وجبات",
      mealType: parseMealType(req.body.mealType, ""),
      items: itemsRaw ?? [],
    });
    if (!parsed.success) {
      res.status(400).json({ error: "بيانات الوجبة غير صالحة — اختر منتجاً واحداً على الأقل" });
      return;
    }

    const componentErr = validateComboComponents(restaurant.id, parsed.data.items);
    if (componentErr) {
      res.status(400).json({ error: componentErr });
      return;
    }

    const id = cuid();
    const imageUrl = req.file ? publicImageUrl(req.file.filename) : null;

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO Product (id, restaurantId, name, description, price, imageUrl, category, mealType, isComboMeal, isStarterMeal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
      ).run(
        id,
        restaurant.id,
        parsed.data.name,
        parsed.data.description ?? null,
        roundMoney(parsed.data.price),
        imageUrl,
        parsed.data.category ?? "وجبات",
        parsed.data.mealType
      );
      saveComboItems(id, parsed.data.items);
    });
    tx();

    const product = db.prepare("SELECT * FROM Product WHERE id = ?").get(id) as Record<string, unknown>;
    res.status(201).json({
      comboMeal: enrichComboProduct(product),
      message: "تم نشر الوجبة — تظهر في أصناف المطعم و«وجبات تبدأ من»",
    });
  });
});

router.put("/combo-meals/:id", authMiddleware(["RESTAURANT"]), (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message ?? "فشل رفع الصورة" });
      return;
    }

    const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
      | { id: string }
      | undefined;
    if (!restaurant) {
      res.status(404).json({ error: "المطعم غير موجود" });
      return;
    }

    const existing = db
      .prepare(
        `SELECT * FROM Product WHERE id = ? AND restaurantId = ? AND isAvailable = 1 AND isComboMeal = 1`
      )
      .get(req.params.id, restaurant.id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: "الوجبة غير موجودة" });
      return;
    }

    const itemsRaw = parseComboItems(req.body.items);
    const parsed = comboBodySchema.safeParse({
      name: req.body.name,
      description: req.body.description,
      price: Number(req.body.price),
      category: req.body.category ?? existing.category,
      mealType: parseMealType(req.body.mealType, existing.mealType as string),
      items: itemsRaw ?? [],
    });
    if (!parsed.success) {
      res.status(400).json({ error: "بيانات الوجبة غير صالحة" });
      return;
    }

    const componentErr = validateComboComponents(
      restaurant.id,
      parsed.data.items,
      req.params.id
    );
    if (componentErr) {
      res.status(400).json({ error: componentErr });
      return;
    }

    const imageUrl = req.file
      ? publicImageUrl(req.file.filename)
      : (existing.imageUrl as string | null);

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE Product SET name = ?, description = ?, price = ?, imageUrl = ?, category = ?, mealType = ?
         WHERE id = ? AND restaurantId = ?`
      ).run(
        parsed.data.name,
        parsed.data.description ?? null,
        roundMoney(parsed.data.price),
        imageUrl,
        parsed.data.category ?? "وجبات",
        parsed.data.mealType,
        req.params.id,
        restaurant.id
      );
      saveComboItems(req.params.id, parsed.data.items);

      const promo = db
        .prepare(`SELECT id, discountedPrice FROM Promotion WHERE productId = ? AND isActive = 1`)
        .get(req.params.id) as { id: string; discountedPrice: number } | undefined;
      if (promo && promo.discountedPrice >= roundMoney(parsed.data.price)) {
        db.prepare(`UPDATE Promotion SET isActive = 0 WHERE id = ?`).run(promo.id);
      }
    });
    tx();

    const product = db.prepare("SELECT * FROM Product WHERE id = ?").get(req.params.id) as Record<
      string,
      unknown
    >;
    res.json({ comboMeal: enrichComboProduct(product) });
  });
});

router.delete("/combo-meals/:id", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const result = db
    .prepare(
      `UPDATE Product SET isAvailable = 0 WHERE id = ? AND restaurantId = ? AND isComboMeal = 1 AND isAvailable = 1`
    )
    .run(req.params.id, restaurant.id);

  if (result.changes === 0) {
    res.status(404).json({ error: "الوجبة غير موجودة" });
    return;
  }

  db.prepare("UPDATE Promotion SET isActive = 0 WHERE productId = ? AND restaurantId = ?").run(
    req.params.id,
    restaurant.id
  );

  res.json({ ok: true });
});

const comboDiscountSchema = z.object({
  discountedPrice: z.coerce.number().positive(),
  reason: z.string().min(2).max(120),
  offerSlot: z.enum(OFFER_SLOTS),
  hourStart: z.string().optional(),
  hourEnd: z.string().optional(),
});

router.post("/combo-meals/:id/discount", authMiddleware(["RESTAURANT"]), (req, res) => {
  try {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const product = db
    .prepare(
      `SELECT * FROM Product WHERE id = ? AND restaurantId = ? AND isAvailable = 1 AND isComboMeal = 1`
    )
    .get(req.params.id, restaurant.id) as
    | { id: string; price: number; category: string; mealType: string }
    | undefined;
  if (!product) {
    res.status(404).json({ error: "الوجبة غير موجودة" });
    return;
  }

  const parsed = comboDiscountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "أدخل سعراً مخفّضاً وقسماً للعروض اليومية" });
    return;
  }

  if (parsed.data.discountedPrice >= roundMoney(product.price)) {
    res.status(400).json({ error: "سعر العرض يجب أن يكون أقل من سعر الوجبة" });
    return;
  }

  const offerSlot = parsed.data.offerSlot;
  let hourStart: string | null = null;
  let hourEnd: string | null = null;
  if (offerSlot === "HOURLY") {
    const hs = parseHourMinute(parsed.data.hourStart);
    const he = parseHourMinute(parsed.data.hourEnd);
    if (!hs || !he) {
      res.status(400).json({ error: "حدّد وقت بداية ونهاية عرض الساعة" });
      return;
    }
    if (!validateHourlyRange(hs, he)) {
      res.status(400).json({
        error: "حدّد وقت بداية ونهاية صالحين لعروض الساعة (مثال 14:00 — 17:00)",
      });
      return;
    }
    hourStart = hs;
    hourEnd = he;
  }

  const existing = db
    .prepare(`SELECT id FROM Promotion WHERE productId = ? AND restaurantId = ? AND isActive = 1`)
    .get(product.id, restaurant.id) as { id: string } | undefined;

  const promoId = existing?.id ?? cuid();
  const discountedPrice = roundMoney(parsed.data.discountedPrice);

  if (existing) {
    db.prepare(
      `UPDATE Promotion SET discountedPrice = ?, reason = ?, offerSlot = ?, hourStart = ?, hourEnd = ?,
       isStarterDeal = 0 WHERE id = ?`
    ).run(
      discountedPrice,
      parsed.data.reason,
      offerSlot,
      hourStart,
      hourEnd,
      promoId
    );
  } else {
    db.prepare(
      `INSERT INTO Promotion (id, restaurantId, productId, discountedPrice, reason, isStarterDeal, offerSlot, hourStart, hourEnd)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(
      promoId,
      restaurant.id,
      product.id,
      discountedPrice,
      parsed.data.reason,
      offerSlot,
      hourStart,
      hourEnd
    );
  }

  const slotLabel = OFFER_SLOT_LABELS[offerSlot];
  res.json({
    message: `تم تطبيق الخصم — يظهر بـ ${discountedPrice} ر.س في «وجبات تبدأ من» و«${slotLabel}»`,
    comboMeal: enrichComboProduct(
      db.prepare("SELECT * FROM Product WHERE id = ?").get(product.id) as Record<string, unknown>
    ),
  });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    console.error("[combo-meals/discount]", e);
    res.status(500).json({ error: `فشل تطبيق الخصم: ${msg}` });
  }
});

router.delete("/combo-meals/:id/discount", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const product = db
    .prepare(`SELECT id FROM Product WHERE id = ? AND restaurantId = ? AND isComboMeal = 1`)
    .get(req.params.id, restaurant.id);
  if (!product) {
    res.status(404).json({ error: "الوجبة غير موجودة" });
    return;
  }

  db.prepare(
    `UPDATE Promotion SET isActive = 0 WHERE productId = ? AND restaurantId = ? AND offerSlot IS NOT NULL`
  ).run(req.params.id, restaurant.id);

  const row = db.prepare("SELECT * FROM Product WHERE id = ?").get(req.params.id) as Record<
    string,
    unknown
  >;
  res.json({
    message: "تم إلغاء الخصم — السعر الأصلي في كل الأقسام",
    comboMeal: enrichComboProduct(row),
  });
});

router.delete("/promotions/:id", authMiddleware(["RESTAURANT"]), (req, res) => {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(req.user!.sub) as
    | { id: string }
    | undefined;
  if (!restaurant) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const result = db
    .prepare(`UPDATE Promotion SET isActive = 0 WHERE id = ? AND restaurantId = ?`)
    .run(req.params.id, restaurant.id);

  if (result.changes === 0) {
    res.status(404).json({ error: "العرض غير موجود" });
    return;
  }

  res.json({ ok: true });
});

export default router;
