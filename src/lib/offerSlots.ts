/** أقسام العروض اليومية — فئات ثابتة + عروض الساعة + أخرى */
export const OFFER_SLOTS = [
  "COFFEE",
  "SWEETS",
  "GRILL",
  "FAST_FOOD",
  "PIZZA",
  "SHAWARMA",
  "BREAKFAST",
  "ARABIC",
  "SANDWICHES",
  "HEALTHY",
  "SEAFOOD",
  "ASIAN",
  "DRINKS",
  "HOURLY",
  "OTHER",
] as const;

export type OfferSlot = (typeof OFFER_SLOTS)[number];

export const CATEGORY_OFFER_SLOTS = OFFER_SLOTS.filter(
  (s): s is Exclude<OfferSlot, "HOURLY" | "OTHER"> => s !== "HOURLY" && s !== "OTHER"
);

export const OFFER_SLOT_LABELS: Record<OfferSlot, string> = {
  COFFEE: "قهوة",
  SWEETS: "حلى",
  GRILL: "مشويات",
  FAST_FOOD: "وجبات سريعة",
  PIZZA: "بيتزا",
  SHAWARMA: "شاورما",
  BREAKFAST: "فطور",
  ARABIC: "أطباق عربية",
  SANDWICHES: "سندويشات",
  HEALTHY: "صحي",
  SEAFOOD: "بحري",
  ASIAN: "آسيوي",
  DRINKS: "مشروبات",
  HOURLY: "عروض الساعة",
  OTHER: "عروض أخرى",
};

export const OFFER_SLOT_EMOJI: Record<OfferSlot, string> = {
  COFFEE: "☕",
  SWEETS: "🍰",
  GRILL: "🔥",
  FAST_FOOD: "🍔",
  PIZZA: "🍕",
  SHAWARMA: "🌯",
  BREAKFAST: "🥐",
  ARABIC: "🍛",
  SANDWICHES: "🥪",
  HEALTHY: "🥗",
  SEAFOOD: "🦐",
  ASIAN: "🍜",
  DRINKS: "🥤",
  HOURLY: "⏰",
  OTHER: "🏷️",
};

export function parseOfferSlot(raw: unknown): OfferSlot | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return OFFER_SLOTS.includes(v as OfferSlot) ? (v as OfferSlot) : null;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseHourMinute(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!TIME_RE.test(t)) return null;
  const [h, m] = t.split(":");
  return `${String(Number(h)).padStart(2, "0")}:${m}`;
}

export function validateHourlyRange(hourStart: string, hourEnd: string): boolean {
  if (!parseHourMinute(hourStart) || !parseHourMinute(hourEnd)) return false;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return toMin(hourStart) !== toMin(hourEnd);
}

function riyadhMinutesNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** هل الوقت الحالي (الرياض) داخل فترة العرض؟ يدعم عبور منتصف الليل */
export function isHourlyPromotionActive(
  hourStart: string | null | undefined,
  hourEnd: string | null | undefined
): boolean {
  if (!hourStart || !hourEnd) return false;
  const start = toMinutes(hourStart);
  const end = toMinutes(hourEnd);
  const now = riyadhMinutesNow();
  if (start < end) return now >= start && now < end;
  if (start > end) return now >= start || now < end;
  return false;
}
