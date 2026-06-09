/** مسافة بالكيلومتر بين نقطتين (Haversine) */
export function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function calcDeliveryFee(
  restaurants: { lat: number; lng: number }[],
  customerLat: number,
  customerLng: number,
  ratePerKm: number,
  minFee: number
): number {
  if (restaurants.length === 0) return 0;
  let total = 0;
  for (const r of restaurants) {
    const km = distanceKm(r.lat, r.lng, customerLat, customerLng);
    total += Math.max(minFee, km * ratePerKm);
  }
  return Math.round(total * 100) / 100;
}
