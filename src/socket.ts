import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { verifyToken } from "./lib/auth.js";
import { db } from "./db.js";
import { setIo } from "./lib/io.js";
import { resumePendingDispatches } from "./lib/captainDispatch.js";

export function setupSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, { cors: { origin: "*" } });
  setIo(io);

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) return next(new Error("غير مصرح"));
    const user = await verifyToken(token);
    if (!user) return next(new Error("جلسة غير صالحة"));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;

    if (user.role === "CAPTAIN") {
      socket.join("captains");
      const captain = db.prepare("SELECT id FROM Captain WHERE userId = ?").get(user.sub) as
        | { id: string }
        | undefined;
      if (captain) {
        socket.join(`captain:${captain.id}`);
        db.prepare(
          `UPDATE Captain SET isOnline = 1, updatedAt = datetime('now') WHERE id = ?`
        ).run(captain.id);
        resumePendingDispatches();
      }
    }

    if (user.role === "RESTAURANT") {
      const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(user.sub) as
        | { id: string }
        | undefined;
      if (restaurant) socket.join(`restaurant:${restaurant.id}`);
    }

    socket.on("captain:location", (payload: { lat: number; lng: number }) => {
      if (user.role !== "CAPTAIN") return;

      db.prepare(
        `UPDATE Captain SET lat = ?, lng = ?, updatedAt = datetime('now') WHERE userId = ?`
      ).run(payload.lat, payload.lng, user.sub);

      resumePendingDispatches();

      const captain = db.prepare("SELECT id FROM Captain WHERE userId = ?").get(user.sub) as
        | { id: string }
        | undefined;
      if (!captain) return;

      const activeOrders = db
        .prepare(
          `SELECT id FROM "Order" WHERE captainId = ? AND status IN ('CAPTAIN_ASSIGNED','PICKED_UP','DELIVERING')`
        )
        .all(captain.id) as { id: string }[];

      for (const order of activeOrders) {
        io.to(`order:${order.id}`).emit("captain:location", {
          orderId: order.id,
          lat: payload.lat,
          lng: payload.lng,
          updatedAt: new Date().toISOString(),
        });
      }
    });

    socket.on("order:subscribe", (orderId: string) => {
      socket.join(`order:${orderId}`);
    });

    // لا نُعطّل isOnline عند انقطاع Socket — المتصفح يقطع الاتصال كثيراً
    // والكابتن يُبقى «متصلاً» حتى يغلق الصفحة صراحةً عبر PATCH /online
  });

  return io;
}
