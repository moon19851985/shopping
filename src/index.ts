import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { fixUnreasonableDeliveryFees } from "./lib/fixDeliveryFees.js";
import authRoutes from "./routes/auth.js";
import catalogRoutes from "./routes/catalog.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payment.js";
import restaurantRoutes from "./routes/restaurant.js";
import captainRoutes from "./routes/captain.js";
import promotionRoutes from "./routes/promotions.js";
import favoritesRoutes from "./routes/favorites.js";
import adminRoutes from "./routes/admin.js";
import { ensureAdminUser } from "./lib/ensureAdmin.js";
import { setupSocket } from "./socket.js";
import {
  processExpiredDispatchOffers,
  resumePendingDispatches,
} from "./lib/captainDispatch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.UPLOAD_DIR ?? path.join(__dirname, "../uploads");
fs.mkdirSync(uploadDir, { recursive: true });

initDb();
fixUnreasonableDeliveryFees();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

app.get("/health", (_req, res) => res.json({ ok: true, service: "gostasrv-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/restaurant", restaurantRoutes);
app.use("/api/captain", captainRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/favorites", favoritesRoutes);
app.use("/api/admin", adminRoutes);

const port = Number(process.env.PORT ?? 4000);
const server = http.createServer(app);
setupSocket(server);

void (async () => {
  await ensureAdminUser();
  resumePendingDispatches();
  setInterval(() => processExpiredDispatchOffers(), 2000);

  server.listen(port, "0.0.0.0", () => {
    console.log(`GOSTASRV API على المنفذ ${port} (جميع الواجهات — الشبكة المحلية)`);
  });
})();
