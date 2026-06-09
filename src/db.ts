import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { resolveCityFromCoords } from "./lib/cities.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, "../data/app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL,
      emailVerified INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS EmailVerification (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      codeHash TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      lastSentAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS Restaurant (
      id TEXT PRIMARY KEY,
      userId TEXT UNIQUE NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      logoUrl TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      address TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS Product (
      id TEXT PRIMARY KEY,
      restaurantId TEXT NOT NULL REFERENCES Restaurant(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      imageUrl TEXT,
      category TEXT NOT NULL,
      mealType TEXT NOT NULL,
      isAvailable INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS Captain (
      id TEXT PRIMARY KEY,
      userId TEXT UNIQUE NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      vehicle TEXT,
      isOnline INTEGER DEFAULT 0,
      lat REAL,
      lng REAL,
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS "Order" (
      id TEXT PRIMARY KEY,
      customerId TEXT NOT NULL REFERENCES User(id),
      captainId TEXT REFERENCES Captain(id),
      status TEXT DEFAULT 'PENDING_PAYMENT',
      deliveryLat REAL NOT NULL,
      deliveryLng REAL NOT NULL,
      deliveryAddress TEXT NOT NULL,
      subtotal REAL NOT NULL,
      deliveryFee REAL NOT NULL,
      total REAL NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS OrderItem (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE,
      restaurantId TEXT NOT NULL,
      productId TEXT NOT NULL REFERENCES Product(id),
      quantity INTEGER NOT NULL,
      unitPrice REAL NOT NULL,
      lineTotal REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Payment (
      id TEXT PRIMARY KEY,
      orderId TEXT UNIQUE NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE,
      provider TEXT DEFAULT 'HUAWEI_IAP',
      status TEXT DEFAULT 'PENDING',
      huaweiPurchaseId TEXT,
      huaweiProductId TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'SAR',
      verifiedAt TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS Promotion (
      id TEXT PRIMARY KEY,
      restaurantId TEXT NOT NULL REFERENCES Restaurant(id) ON DELETE CASCADE,
      productId TEXT NOT NULL REFERENCES Product(id) ON DELETE CASCADE,
      discountedPrice REAL NOT NULL,
      reason TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
    );
  `);

  migrateUserEmailVerified();
  migratePaymentColumns();
  migrateOrderHiddenByCustomer();
  migrateOrderHiddenByCaptain();
  migratePromotionTable();
  migrateFavoriteRestaurant();
  migrateRestaurantCity();
  migrateOrderInvoiceNumber();
  migrateOrderTimestamps();
  migratePackageTables();
  migratePromotionStarterDeal();
  migratePromotionOfferSlot();
  migratePromotionOfferDeliveryFee();
  migrateComboMeals();
  migrateOrderDispatch();
  migrateCaptainPushToken();
  migratePayoutRecord();
}

function migrateCaptainPushToken() {
  const cols = db.prepare(`PRAGMA table_info(Captain)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "pushToken")) {
    db.exec(`ALTER TABLE Captain ADD COLUMN pushToken TEXT`);
  }
}

function migratePayoutRecord() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS PayoutRecord (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      beneficiaryId TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      createdBy TEXT REFERENCES User(id),
      createdAt TEXT DEFAULT (datetime('now'))
    );
  `);
}

function migrateOrderDispatch() {
  const cols = db.prepare(`PRAGMA table_info("Order")`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "offeredCaptainId")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN offeredCaptainId TEXT REFERENCES Captain(id)`);
  }
  if (!cols.some((c) => c.name === "offerExpiresAt")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN offerExpiresAt TEXT`);
  }
  if (!cols.some((c) => c.name === "dispatchQueue")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN dispatchQueue TEXT`);
  }
  if (!cols.some((c) => c.name === "dispatchIndex")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN dispatchIndex INTEGER DEFAULT 0`);
  }
  if (!cols.some((c) => c.name === "dispatchVisibleCaptains")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN dispatchVisibleCaptains TEXT`);
  }
}

function migrateComboMeals() {
  const cols = db.prepare(`PRAGMA table_info(Product)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "isComboMeal")) {
    db.exec(`ALTER TABLE Product ADD COLUMN isComboMeal INTEGER DEFAULT 0`);
  }
  if (!cols.some((c) => c.name === "isStarterMeal")) {
    db.exec(`ALTER TABLE Product ADD COLUMN isStarterMeal INTEGER DEFAULT 0`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ComboItem (
      id TEXT PRIMARY KEY,
      comboProductId TEXT NOT NULL REFERENCES Product(id) ON DELETE CASCADE,
      componentProductId TEXT NOT NULL REFERENCES Product(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      UNIQUE(comboProductId, componentProductId)
    );
  `);
}

function migratePromotionOfferDeliveryFee() {
  const cols = db.prepare(`PRAGMA table_info(Promotion)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "offerDeliveryFee")) {
    db.exec(`ALTER TABLE Promotion ADD COLUMN offerDeliveryFee REAL`);
  }
}

function migratePromotionStarterDeal() {
  const cols = db.prepare(`PRAGMA table_info(Promotion)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "isStarterDeal")) {
    db.exec(`ALTER TABLE Promotion ADD COLUMN isStarterDeal INTEGER DEFAULT 0`);
  }
}

function migratePromotionOfferSlot() {
  const cols = db.prepare(`PRAGMA table_info(Promotion)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "offerSlot")) {
    db.exec(`ALTER TABLE Promotion ADD COLUMN offerSlot TEXT`);
  }
  if (!cols.some((c) => c.name === "hourStart")) {
    db.exec(`ALTER TABLE Promotion ADD COLUMN hourStart TEXT`);
  }
  if (!cols.some((c) => c.name === "hourEnd")) {
    db.exec(`ALTER TABLE Promotion ADD COLUMN hourEnd TEXT`);
  }
}

function migratePackageTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Package (
      id TEXT PRIMARY KEY,
      restaurantId TEXT NOT NULL REFERENCES Restaurant(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      imageUrl TEXT,
      price REAL NOT NULL,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS PackageItem (
      id TEXT PRIMARY KEY,
      packageId TEXT NOT NULL REFERENCES Package(id) ON DELETE CASCADE,
      productId TEXT NOT NULL REFERENCES Product(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      UNIQUE(packageId, productId)
    );
  `);
}

function migrateOrderTimestamps() {
  const cols = db.prepare(`PRAGMA table_info("Order")`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "pickedUpAt")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN pickedUpAt TEXT`);
  }
  if (!cols.some((c) => c.name === "deliveredAt")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN deliveredAt TEXT`);
  }

  db.exec(
    `UPDATE "Order" SET pickedUpAt = updatedAt
     WHERE pickedUpAt IS NULL AND status IN ('PICKED_UP','DELIVERING','DELIVERED')`
  );
  db.exec(
    `UPDATE "Order" SET deliveredAt = updatedAt
     WHERE deliveredAt IS NULL AND status = 'DELIVERED'`
  );
}

function migrateOrderInvoiceNumber() {
  const cols = db.prepare(`PRAGMA table_info("Order")`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "invoiceNumber")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN invoiceNumber TEXT`);
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS Order_invoiceNumber_key ON "Order"(invoiceNumber) WHERE invoiceNumber IS NOT NULL`
  );

  const unpaid = db
    .prepare(
      `SELECT id FROM "Order" WHERE status = 'PENDING_PAYMENT' AND invoiceNumber IS NOT NULL`
    )
    .all() as { id: string }[];
  for (const o of unpaid) {
    db.prepare(`UPDATE "Order" SET invoiceNumber = NULL WHERE id = ?`).run(o.id);
  }

  const paidWithout = db
    .prepare(
      `SELECT id FROM "Order"
       WHERE status NOT IN ('PENDING_PAYMENT', 'CANCELLED') AND invoiceNumber IS NULL`
    )
    .all() as { id: string }[];

  for (const o of paidWithout) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const row = db
      .prepare(`SELECT COUNT(*) as n FROM "Order" WHERE invoiceNumber IS NOT NULL`)
      .get() as { n: number };
    const seq = Number(row.n) + 1;
    const invoiceNumber = `INV-${date}-${String(seq).padStart(5, "0")}`;
    db.prepare(`UPDATE "Order" SET invoiceNumber = ? WHERE id = ?`).run(invoiceNumber, o.id);
  }
}

function migrateRestaurantCity() {
  const cols = db.prepare(`PRAGMA table_info(Restaurant)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "city")) {
    db.exec(`ALTER TABLE Restaurant ADD COLUMN city TEXT`);
  }
  const rows = db
    .prepare(`SELECT id, lat, lng FROM Restaurant WHERE city IS NULL OR city = ''`)
    .all() as { id: string; lat: number; lng: number }[];
  const update = db.prepare(`UPDATE Restaurant SET city = ? WHERE id = ?`);
  for (const r of rows) {
    update.run(resolveCityFromCoords(r.lat, r.lng).nameAr, r.id);
  }
}

function migrateFavoriteRestaurant() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS FavoriteRestaurant (
      userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
      restaurantId TEXT NOT NULL REFERENCES Restaurant(id) ON DELETE CASCADE,
      createdAt TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (userId, restaurantId)
    );
  `);
}

function migratePromotionTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Promotion (
      id TEXT PRIMARY KEY,
      restaurantId TEXT NOT NULL REFERENCES Restaurant(id) ON DELETE CASCADE,
      productId TEXT NOT NULL REFERENCES Product(id) ON DELETE CASCADE,
      discountedPrice REAL NOT NULL,
      reason TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
    );
  `);
}

function migrateOrderHiddenByCaptain() {
  const cols = db.prepare(`PRAGMA table_info("Order")`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "hiddenByCaptain")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN hiddenByCaptain INTEGER DEFAULT 0`);
  }
}

function migrateOrderHiddenByCustomer() {
  const cols = db.prepare(`PRAGMA table_info("Order")`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "hiddenByCustomer")) {
    db.exec(`ALTER TABLE "Order" ADD COLUMN hiddenByCustomer INTEGER DEFAULT 0`);
  }
}

function migratePaymentColumns() {
  let cols = db.prepare(`PRAGMA table_info(Payment)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "paymentMethod")) {
    db.exec(`ALTER TABLE Payment ADD COLUMN paymentMethod TEXT`);
  }
  cols = db.prepare(`PRAGMA table_info(Payment)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "transactionId")) {
    db.exec(`ALTER TABLE Payment ADD COLUMN transactionId TEXT`);
  }
}

function migrateUserEmailVerified() {
  const cols = db.prepare(`PRAGMA table_info(User)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "emailVerified")) {
    db.exec(`ALTER TABLE User ADD COLUMN emailVerified INTEGER DEFAULT 0`);
    db.exec(`UPDATE User SET emailVerified = 1`);
  }
}

function cuid() {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export { cuid };
