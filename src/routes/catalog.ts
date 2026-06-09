import { Router } from "express";
import { db } from "../db.js";
import { cityNameFromQuery } from "../lib/cities.js";
import { normalizeImageUrl } from "../lib/imageUrl.js";
import { promotionPricing } from "../lib/promotionEnrich.js";
import { loadComboItems } from "../lib/comboMeal.js";
import { isHourlyPromotionActive } from "../lib/offerSlots.js";

const router = Router();

const mealLabels: Record<string, string> = {
  BREAKFAST: "فطور",
  LUNCH: "غداء",
  DINNER: "عشاء",
};

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  category: string;
  mealType: string;
  isComboMeal?: number | null;
  restaurantId: string;
  restaurantName: string;
  restaurantLogo: string | null;
  restaurantLat: number;
  restaurantLng: number;
};

function withCityFilter(
  where: string,
  params: unknown[],
  cityParam: string | undefined
): { where: string; params: unknown[] } {
  const city = cityNameFromQuery(cityParam);
  if (!city) return { where, params };
  return { where: `${where} AND r.city = ?`, params: [...params, city] };
}

function fetchProducts(where = "p.isAvailable = 1 AND r.isActive = 1", params: unknown[] = []) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.description, p.price, p.imageUrl, p.category, p.mealType, p.isComboMeal,
              r.id as restaurantId, r.name as restaurantName, r.logoUrl as restaurantLogo,
              r.lat as restaurantLat, r.lng as restaurantLng
       FROM Product p
       JOIN Restaurant r ON r.id = p.restaurantId
       WHERE ${where}
       ORDER BY p.category ASC`
    )
    .all(...params) as ProductRow[];
}

function groupByCategory(products: ProductRow[]) {
  const byCategory = new Map<string, ReturnType<typeof formatProduct>[]>();
  for (const p of products) {
    const key = p.category.trim();
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(formatProduct(p));
  }
  return [...byCategory.entries()].map(([category, items]) => ({ category, products: items }));
}

function formatProduct(p: ProductRow) {
  const promo = db
    .prepare(
      `SELECT discountedPrice, offerDeliveryFee, offerSlot FROM Promotion WHERE productId = ? AND isActive = 1 LIMIT 1`
    )
    .get(p.id) as
    | { discountedPrice: number; offerDeliveryFee: number | null; offerSlot: string | null }
    | undefined;

  const offerDeliveryFee =
    promo?.offerDeliveryFee != null && Number.isFinite(promo.offerDeliveryFee)
      ? roundMoney(promo.offerDeliveryFee)
      : null;

  const basePrice = roundMoney(p.price);
  const promoPrice = promo ? roundMoney(promo.discountedPrice) : null;
  const hasDiscount = promoPrice != null && promoPrice < basePrice;

  const comboItems = p.isComboMeal
    ? loadComboItems(p.id).map((i) => ({
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
      }))
    : undefined;

  const base = {
    id: p.id,
    name: p.name,
    description: p.description,
    price: hasDiscount ? promoPrice! : basePrice,
    originalPrice: hasDiscount ? basePrice : undefined,
    hasPromotion: hasDiscount,
    isComboMeal: !!p.isComboMeal,
    comboItems,
    offerDeliveryFee,
    imageUrl: normalizeImageUrl(p.imageUrl),
    mealType: p.mealType || null,
    mealLabel: p.mealType ? (mealLabels[p.mealType] ?? p.mealType) : null,
    category: p.category,
    restaurant: {
      id: p.restaurantId,
      name: p.restaurantName,
      logoUrl: normalizeImageUrl(p.restaurantLogo),
      lat: p.restaurantLat,
      lng: p.restaurantLng,
    },
  };
  return base;
}

function formatRestaurantRow(r: Record<string, unknown>) {
  return {
    ...r,
    logoUrl: normalizeImageUrl(r.logoUrl as string | null),
    lat: Number(r.lat),
    lng: Number(r.lng),
    productCount: Number(r.productCount ?? 0),
  };
}

router.get("/aggregated", (req, res) => {
  const filtered = withCityFilter("p.isAvailable = 1 AND r.isActive = 1", [], req.query.city as string | undefined);
  const products = fetchProducts(filtered.where, filtered.params);
  res.json({ categories: groupByCategory(products), city: cityNameFromQuery(req.query.city as string | undefined) });
});

router.get("/by-meal/:mealType", (req, res) => {
  const mealType = req.params.mealType.toUpperCase();
  if (!["BREAKFAST", "LUNCH", "DINNER"].includes(mealType)) {
    res.status(400).json({ error: "نوع وجبة غير صالح" });
    return;
  }
  const filtered = withCityFilter(
    "p.mealType = ? AND p.isAvailable = 1 AND r.isActive = 1",
    [mealType],
    req.query.city as string | undefined
  );
  const products = fetchProducts(filtered.where, filtered.params);
  res.json({
    mealType,
    mealLabel: mealLabels[mealType],
    categories: groupByCategory(products),
  });
});

router.get("/restaurants", (req, res) => {
  const filtered = withCityFilter("r.isActive = 1", [], req.query.city as string | undefined);
  const restaurants = db
    .prepare(
      `SELECT r.id, r.name, r.description, r.logoUrl, r.lat, r.lng, r.address, r.city,
              (SELECT COUNT(*) FROM Product p WHERE p.restaurantId = r.id AND p.isAvailable = 1) as productCount
       FROM Restaurant r
       WHERE ${filtered.where}
       ORDER BY r.name ASC`
    )
    .all(...filtered.params)
    .map((r) => formatRestaurantRow(r as Record<string, unknown>));
  res.json({ restaurants, city: cityNameFromQuery(req.query.city as string | undefined) });
});

router.get("/restaurants/:id", (req, res) => {
  const row = db
    .prepare(
      `SELECT r.id, r.name, r.description, r.logoUrl, r.lat, r.lng, r.address, r.city,
              (SELECT COUNT(*) FROM Product p WHERE p.restaurantId = r.id AND p.isAvailable = 1) as productCount
       FROM Restaurant r WHERE r.id = ? AND r.isActive = 1`
    )
    .get(req.params.id) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }
  res.json({ restaurant: formatRestaurantRow(row) });
});

type PackageRow = {
  id: string;
  restaurantId: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  restaurantName: string;
  restaurantLogo: string | null;
};

function loadPackageItems(packageId: string) {
  return db
    .prepare(
      `SELECT pi.quantity, p.id as productId, p.name as productName, p.price as productPrice, p.imageUrl
       FROM PackageItem pi
       JOIN Product p ON p.id = pi.productId
       WHERE pi.packageId = ? AND p.isAvailable = 1`
    )
    .all(packageId) as {
    quantity: number;
    productId: string;
    productName: string;
    productPrice: number;
    imageUrl: string | null;
  }[];
}

function formatPackage(pkg: PackageRow) {
  const items = loadPackageItems(pkg.id);
  const originalPrice = roundMoney(
    items.reduce((s, i) => s + Number(i.productPrice) * i.quantity, 0)
  );
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    price: roundMoney(Number(pkg.price)),
    originalPrice: originalPrice > 0 ? originalPrice : undefined,
    imageUrl: normalizeImageUrl(pkg.imageUrl),
    items: items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      quantity: i.quantity,
      productPrice: roundMoney(Number(i.productPrice)),
    })),
    restaurant: {
      id: pkg.restaurantId,
      name: pkg.restaurantName,
      logoUrl: normalizeImageUrl(pkg.restaurantLogo),
    },
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

router.get("/packages", (req, res) => {
  const filtered = withCityFilter(
    "pkg.isActive = 1 AND r.isActive = 1",
    [],
    req.query.city as string | undefined
  );
  const rows = db
    .prepare(
      `SELECT pkg.id, pkg.restaurantId, pkg.name, pkg.description, pkg.price, pkg.imageUrl,
              r.name as restaurantName, r.logoUrl as restaurantLogo
       FROM Package pkg
       JOIN Restaurant r ON r.id = pkg.restaurantId
       WHERE ${filtered.where}
       ORDER BY pkg.createdAt DESC`
    )
    .all(...filtered.params) as PackageRow[];

  const packages = rows
    .map(formatPackage)
    .filter((p) => p.items.length > 0);

  res.json({ packages, city: cityNameFromQuery(req.query.city as string | undefined) });
});

type StarterMealRow = {
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
  restaurantLat: number;
  restaurantLng: number;
  offerDeliveryFee?: number | null;
  offerSlot?: string | null;
  hourStart?: string | null;
  hourEnd?: string | null;
  isStarterDeal?: number | null;
};

function formatStarterMeal(row: StarterMealRow) {
  const pricing = promotionPricing(row);

  return {
    id: row.id,
    productId: row.productId,
    discountedPrice: pricing.discountedPrice,
    originalPrice: pricing.originalPrice,
    savingsPercent: pricing.savingsPercent,
    offerDeliveryFee: pricing.offerDeliveryFee,
    reason: row.reason,
    createdAt: row.createdAt,
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
      lat: Number(row.restaurantLat),
      lng: Number(row.restaurantLng),
    },
  };
}

function fetchStarterMealRows(cityParam: string | undefined): StarterMealRow[] {
  const city = cityNameFromQuery(cityParam);
  const citySql = city ? " AND r.city = ?" : "";
  const cityParams = city ? [city] : [];

  const comboRows = db
    .prepare(
      `SELECT COALESCE(pr.id, p.id) as id, p.restaurantId, p.id as productId,
              COALESCE(pr.discountedPrice, p.price) as discountedPrice,
              p.price as originalPrice,
              COALESCE(pr.reason, 'وجبة') as reason,
              COALESCE(pr.createdAt, p.createdAt) as createdAt,
              pr.offerDeliveryFee, pr.offerSlot, pr.hourStart, pr.hourEnd,
              p.name as productName, p.imageUrl, p.category, p.mealType,
              r.name as restaurantName, r.logoUrl as restaurantLogo,
              r.lat as restaurantLat, r.lng as restaurantLng
       FROM Product p
       JOIN Restaurant r ON r.id = p.restaurantId
       LEFT JOIN Promotion pr ON pr.productId = p.id AND pr.isActive = 1
       WHERE p.isStarterMeal = 1 AND p.isAvailable = 1 AND r.isActive = 1${citySql}
       ORDER BY discountedPrice ASC, p.createdAt DESC`
    )
    .all(...cityParams) as StarterMealRow[];

  const legacyRows = db
    .prepare(
      `SELECT pr.id, pr.restaurantId, pr.productId, pr.discountedPrice, pr.reason, pr.createdAt,
              pr.offerDeliveryFee, pr.offerSlot, pr.hourStart, pr.hourEnd,
              p.name as productName, p.price as originalPrice, p.imageUrl, p.category, p.mealType,
              r.name as restaurantName, r.logoUrl as restaurantLogo, r.lat as restaurantLat, r.lng as restaurantLng
       FROM Promotion pr
       JOIN Product p ON p.id = pr.productId
       JOIN Restaurant r ON r.id = pr.restaurantId
       WHERE pr.isActive = 1 AND pr.isStarterDeal = 1
         AND (p.isStarterMeal IS NULL OR p.isStarterMeal = 0)
         AND p.isAvailable = 1 AND r.isActive = 1${citySql}
       ORDER BY pr.discountedPrice ASC, pr.createdAt DESC`
    )
    .all(...cityParams) as StarterMealRow[];

  const seen = new Set<string>();
  const merged: StarterMealRow[] = [];
  for (const row of [...comboRows, ...legacyRows]) {
    if (seen.has(row.productId)) continue;
    seen.add(row.productId);
    if (row.offerSlot === "HOURLY" && !isHourlyPromotionActive(row.hourStart, row.hourEnd)) {
      continue;
    }
    merged.push(row);
  }
  return merged;
}

router.get("/starter-meals", (req, res) => {
  const rows = fetchStarterMealRows(req.query.city as string | undefined);
  const meals = rows.map(formatStarterMeal);
  const startingFrom =
    meals.length > 0 ? Math.floor(Math.min(...meals.map((m) => m.discountedPrice))) : null;

  res.json({
    meals,
    startingFrom,
    city: cityNameFromQuery(req.query.city as string | undefined),
  });
});

router.get("/restaurants/:id/products", (req, res) => {
  const row = db
    .prepare(`SELECT id FROM Restaurant WHERE id = ? AND isActive = 1`)
    .get(req.params.id);
  if (!row) {
    res.status(404).json({ error: "المطعم غير موجود" });
    return;
  }

  const products = fetchProducts(
    "p.restaurantId = ? AND p.isAvailable = 1 AND r.isActive = 1",
    [req.params.id]
  );
  res.json({
    products: products.map(formatProduct),
    categories: groupByCategory(products),
  });
});

export default router;
