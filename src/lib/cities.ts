/** مراكز مدن رئيسية — أقرب مدينة حسب المسافة من الإحداثيات */
export type CityDef = {
  key: string;
  nameAr: string;
  lat: number;
  lng: number;
  radiusKm: number;
};

export const SAUDI_CITIES: CityDef[] = [
  { key: "riyadh", nameAr: "الرياض", lat: 24.7136, lng: 46.6753, radiusKm: 85 },
  { key: "jeddah", nameAr: "جدة", lat: 21.4858, lng: 39.1925, radiusKm: 75 },
  { key: "makkah", nameAr: "مكة", lat: 21.3891, lng: 39.8579, radiusKm: 60 },
  { key: "madinah", nameAr: "المدينة", lat: 24.4672, lng: 39.6111, radiusKm: 70 },
  { key: "dammam", nameAr: "الدمام", lat: 26.4207, lng: 50.0888, radiusKm: 70 },
  { key: "khobar", nameAr: "الخبر", lat: 26.2172, lng: 50.1971, radiusKm: 55 },
  { key: "tabuk", nameAr: "تبوك", lat: 28.3838, lng: 36.555, radiusKm: 70 },
  { key: "abha", nameAr: "أبها", lat: 18.2164, lng: 42.5053, radiusKm: 65 },
  { key: "khamis", nameAr: "خميس مشيط", lat: 18.3, lng: 42.7333, radiusKm: 55 },
  { key: "buraidah", nameAr: "بريدة", lat: 26.326, lng: 43.975, radiusKm: 60 },
  { key: "hail", nameAr: "حائل", lat: 27.5114, lng: 41.7208, radiusKm: 65 },
  { key: "najran", nameAr: "نجران", lat: 17.4924, lng: 44.1277, radiusKm: 60 },
];

const ALIASES: Record<string, string> = {
  riyadh: "الرياض",
  الرياض: "الرياض",
  arriyadh: "الرياض",
  jeddah: "جدة",
  جدة: "جدة",
  jedda: "جدة",
  makkah: "مكة",
  mecca: "مكة",
  مكة: "مكة",
  madinah: "المدينة",
  medina: "المدينة",
  المدينة: "المدينة",
  dammam: "الدمام",
  الدمام: "الدمام",
  khobar: "الخبر",
  alkhobar: "الخبر",
  الخبر: "الخبر",
  tabuk: "تبوك",
  تبوك: "تبوك",
  abha: "أبها",
  أبها: "أبها",
  buraidah: "بريدة",
  بريدة: "بريدة",
  hail: "حائل",
  حائل: "حائل",
  najran: "نجران",
  نجران: "نجران",
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function normalizeCityName(input?: string | null): string | null {
  if (!input?.trim()) return null;
  const key = input.trim().toLowerCase().replace(/\s+/g, "");
  return ALIASES[key] ?? null;
}

export function resolveCityFromCoords(lat: number, lng: number): CityDef {
  let best = SAUDI_CITIES[0];
  let bestDist = Infinity;
  for (const c of SAUDI_CITIES) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function cityNameFromQuery(query: string | undefined): string | null {
  if (!query?.trim()) return null;
  const direct = normalizeCityName(query);
  if (direct) return direct;
  const byKey = SAUDI_CITIES.find((c) => c.key === query.trim().toLowerCase());
  return byKey?.nameAr ?? null;
}
