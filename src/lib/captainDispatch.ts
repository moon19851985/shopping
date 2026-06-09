import { db } from "../db.js";
import { distanceKm } from "./geo.js";
import { getIo } from "./io.js";
import { sendCaptainPushNotification } from "./pushNotify.js";

/** مدة أولوية العرض قبل إضافة الكابتن التالي */
export const DISPATCH_OFFER_SECONDS = 30;

const DISPATCHABLE_STATUSES = ["PAID", "PREPARING", "READY_FOR_PICKUP"] as const;

type RestaurantPoint = { lat: number; lng: number };
type CaptainCandidate = { id: string; lat: number; lng: number; userId: string };

type DispatchState = {
  id: string;
  status: string;
  captainId: string | null;
  queue: string[];
  index: number;
  visible: string[];
  nextAdvanceAt: string | null;
};

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
  } catch {
    /* ignore */
  }
  return [];
}

function getOrderRestaurants(orderId: string): RestaurantPoint[] {
  return db
    .prepare(
      `SELECT DISTINCT r.lat, r.lng
       FROM OrderItem oi
       JOIN Restaurant r ON r.id = oi.restaurantId
       WHERE oi.orderId = ?`
    )
    .all(orderId) as RestaurantPoint[];
}

function captainDistanceKm(captain: CaptainCandidate, restaurants: RestaurantPoint[]): number {
  if (restaurants.length === 0) return Infinity;
  return Math.min(
    ...restaurants.map((r) => distanceKm(captain.lat, captain.lng, r.lat, r.lng))
  );
}

export function buildCaptainQueue(orderId: string, skipCaptainIds: string[] = []): string[] {
  const restaurants = getOrderRestaurants(orderId);
  const captains = db
    .prepare(
      `SELECT id, lat, lng, userId FROM Captain
       WHERE isOnline = 1 AND lat IS NOT NULL AND lng IS NOT NULL`
    )
    .all() as CaptainCandidate[];

  const skip = new Set(skipCaptainIds);
  return captains
    .filter((c) => !skip.has(c.id))
    .map((c) => ({ id: c.id, km: captainDistanceKm(c, restaurants) }))
    .sort((a, b) => a.km - b.km)
    .map((c) => c.id);
}

export function isDispatchableStatus(status: string, captainId: string | null) {
  return captainId == null && (DISPATCHABLE_STATUSES as readonly string[]).includes(status);
}

function loadDispatchState(orderId: string): DispatchState | null {
  const row = db
    .prepare(
      `SELECT id, status, captainId, dispatchQueue, dispatchIndex, dispatchVisibleCaptains, offerExpiresAt, offeredCaptainId
       FROM "Order" WHERE id = ?`
    )
    .get(orderId) as
    | {
        id: string;
        status: string;
        captainId: string | null;
        dispatchQueue: string | null;
        dispatchIndex: number | null;
        dispatchVisibleCaptains: string | null;
        offerExpiresAt: string | null;
        offeredCaptainId: string | null;
      }
    | undefined;

  if (!row) return null;

  let visible = parseStringArray(row.dispatchVisibleCaptains);
  if (visible.length === 0 && row.offeredCaptainId) {
    visible = [row.offeredCaptainId];
  }

  return {
    id: row.id,
    status: row.status,
    captainId: row.captainId,
    queue: parseStringArray(row.dispatchQueue),
    index: row.dispatchIndex ?? -1,
    visible,
    nextAdvanceAt: row.offerExpiresAt,
  };
}

function persistDispatchState(state: DispatchState) {
  db.prepare(
    `UPDATE "Order" SET dispatchQueue = ?, dispatchIndex = ?, dispatchVisibleCaptains = ?,
      offerExpiresAt = ?, offeredCaptainId = ?, updatedAt = datetime('now') WHERE id = ?`
  ).run(
    JSON.stringify(state.queue),
    state.index,
    JSON.stringify(state.visible),
    state.nextAdvanceAt,
    state.visible[state.visible.length - 1] ?? null,
    state.id
  );
}

function clearDispatchFields(orderId: string) {
  db.prepare(
    `UPDATE "Order" SET offeredCaptainId = NULL, offerExpiresAt = NULL, dispatchQueue = NULL,
      dispatchIndex = -1, dispatchVisibleCaptains = NULL, updatedAt = datetime('now') WHERE id = ?`
  ).run(orderId);
}

function emitOfferToCaptain(captainId: string, orderId: string, priorityEndsAt: string | null) {
  const order = db
    .prepare(`SELECT deliveryAddress, deliveryFee, total FROM "Order" WHERE id = ?`)
    .get(orderId) as { deliveryAddress: string; deliveryFee: number; total: number } | undefined;

  getIo()?.to(`captain:${captainId}`).emit("dispatch:offer", {
    orderId,
    seconds: DISPATCH_OFFER_SECONDS,
    expiresAt: priorityEndsAt,
    deliveryAddress: order?.deliveryAddress,
    deliveryFee: order?.deliveryFee,
    total: order?.total,
  });

  const captain = db
    .prepare(`SELECT pushToken FROM Captain WHERE id = ?`)
    .get(captainId) as { pushToken: string | null } | undefined;

  if (captain?.pushToken) {
    const fee = order?.deliveryFee != null ? `${Number(order.deliveryFee).toFixed(2)} ر.س` : "";
    const addr = order?.deliveryAddress?.slice(0, 80) ?? "طلب جديد";
    void sendCaptainPushNotification(captain.pushToken, {
      title: "طلب توصيل جديد",
      body: fee ? `أجرة ${fee} — ${addr}` : addr,
      orderId,
    });
  }
}

function emitWithdrawOffer(captainId: string, orderId: string) {
  getIo()?.to(`captain:${captainId}`).emit("dispatch:withdrawn", { orderId });
}

function hasMoreCaptainsToAdd(state: DispatchState): boolean {
  return state.queue.some((id) => !state.visible.includes(id));
}

function scheduleNextAdvance(state: DispatchState) {
  state.nextAdvanceAt = hasMoreCaptainsToAdd(state)
    ? new Date(Date.now() + DISPATCH_OFFER_SECONDS * 1000).toISOString()
    : null;
}

function addNextCaptainToVisible(state: DispatchState): boolean {
  const nextCaptain = state.queue.find((id) => !state.visible.includes(id));
  if (!nextCaptain) {
    state.nextAdvanceAt = null;
    return false;
  }

  state.visible.push(nextCaptain);
  state.index = state.queue.indexOf(nextCaptain);
  scheduleNextAdvance(state);
  emitOfferToCaptain(nextCaptain, state.id, state.nextAdvanceAt);
  return true;
}

function beginDispatch(orderId: string, queue: string[]) {
  if (queue.length === 0) {
    clearDispatchFields(orderId);
    return;
  }

  const state: DispatchState = {
    id: orderId,
    status: "",
    captainId: null,
    queue,
    index: 0,
    visible: [queue[0]],
    nextAdvanceAt: new Date(Date.now() + DISPATCH_OFFER_SECONDS * 1000).toISOString(),
  };
  persistDispatchState(state);
  emitOfferToCaptain(queue[0], orderId, state.nextAdvanceAt);
}

/** بدء أو استئناف توزيع الطلب على الكباتن المتصلين (الأقرب أولاً) */
export function startDispatch(orderId: string) {
  const state = loadDispatchState(orderId);
  if (!state || !isDispatchableStatus(state.status, state.captainId)) return;

  if (state.visible.length > 0) {
    if (state.nextAdvanceAt) {
      const expiresMs = new Date(state.nextAdvanceAt).getTime();
      if (Number.isFinite(expiresMs) && expiresMs > Date.now()) return;
      addNextCaptainToVisible(state);
      persistDispatchState(state);
    }
    return;
  }

  let queue = state.queue;
  if (queue.length === 0) {
    queue = buildCaptainQueue(orderId);
  }
  beginDispatch(orderId, queue);
}

/** انتهاء مهلة الأولوية — إضافة الكابتن التالي دون إخفاء العرض عن السابقين */
export function advanceDispatch(orderId: string) {
  const state = loadDispatchState(orderId);
  if (!state || !isDispatchableStatus(state.status, state.captainId)) {
    clearDispatchFields(orderId);
    return;
  }

  if (state.queue.length === 0) {
    state.queue = buildCaptainQueue(orderId);
  }

  if (!addNextCaptainToVisible(state)) {
    getIo()?.to("captains").emit("dispatch:exhausted", { orderId });
  }
  persistDispatchState(state);
}

export function rejectDispatchOffer(orderId: string, captainId: string) {
  const state = loadDispatchState(orderId);
  if (!state || !isDispatchableStatus(state.status, state.captainId)) return;

  if (!state.visible.includes(captainId)) return;

  state.visible = state.visible.filter((id) => id !== captainId);
  state.queue = state.queue.filter((id) => id !== captainId);
  emitWithdrawOffer(captainId, orderId);

  if (state.visible.length === 0 && state.queue.length > 0) {
    beginDispatch(orderId, state.queue);
    return;
  }

  if (hasMoreCaptainsToAdd(state)) {
    addNextCaptainToVisible(state);
  } else {
    state.nextAdvanceAt = null;
  }
  persistDispatchState(state);
}

export function completeDispatchAccept(orderId: string, acceptingCaptainId: string) {
  const state = loadDispatchState(orderId);
  const visible = state?.visible ?? [];

  for (const captainId of visible) {
    if (captainId !== acceptingCaptainId) {
      emitWithdrawOffer(captainId, orderId);
    }
  }

  clearDispatchFields(orderId);
}

export function findVisibleOffersForCaptain(captainId: string): Record<string, unknown>[] {
  const rows = db
    .prepare(
      `SELECT * FROM "Order"
       WHERE captainId IS NULL
         AND status IN ('PAID','PREPARING','READY_FOR_PICKUP')
         AND dispatchVisibleCaptains IS NOT NULL
       ORDER BY createdAt DESC`
    )
    .all() as Record<string, unknown>[];

  const offers = rows.filter((row) => {
    const visible = parseStringArray(row.dispatchVisibleCaptains as string | null);
    return visible.includes(captainId);
  });

  const legacy = db
    .prepare(
      `SELECT * FROM "Order"
       WHERE offeredCaptainId = ? AND captainId IS NULL
         AND status IN ('PAID','PREPARING','READY_FOR_PICKUP')
         AND (dispatchVisibleCaptains IS NULL OR dispatchVisibleCaptains = '[]')
       ORDER BY createdAt DESC`
    )
    .all(captainId) as Record<string, unknown>[];

  const seen = new Set(offers.map((o) => o.id as string));
  for (const row of legacy) {
    if (!seen.has(row.id as string)) offers.push(row);
  }

  return offers;
}

export function captainCanAcceptOrder(
  orderId: string,
  captainId: string
): { ok: true } | { ok: false; error: string } {
  const state = loadDispatchState(orderId);
  if (!state || !isDispatchableStatus(state.status, state.captainId)) {
    return { ok: false, error: "الطلب غير متاح أو تم قبوله من كابتن آخر" };
  }
  if (!state.visible.includes(captainId)) {
    return { ok: false, error: "الطلب غير معروض عليك" };
  }
  return { ok: true };
}

export function processExpiredDispatchOffers() {
  const candidates = db
    .prepare(
      `SELECT id, offerExpiresAt FROM "Order"
       WHERE captainId IS NULL
         AND offerExpiresAt IS NOT NULL
         AND dispatchVisibleCaptains IS NOT NULL
         AND status IN ('PAID','PREPARING','READY_FOR_PICKUP')`
    )
    .all() as { id: string; offerExpiresAt: string }[];

  const now = Date.now();
  for (const row of candidates) {
    const expiresMs = new Date(row.offerExpiresAt).getTime();
    if (Number.isFinite(expiresMs) && expiresMs <= now) {
      advanceDispatch(row.id);
    }
  }
}

export function resumePendingDispatches() {
  const pending = db
    .prepare(
      `SELECT id FROM "Order"
       WHERE captainId IS NULL
         AND status IN ('PAID','PREPARING','READY_FOR_PICKUP')`
    )
    .all() as { id: string }[];

  for (const { id } of pending) {
    startDispatch(id);
  }
}
