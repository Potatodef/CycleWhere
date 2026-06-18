import type { LatLng } from "../types.js";

const EARTH_RADIUS_KM = 6371;

export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function haversineKm(a: LatLng, b: LatLng) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(x));
}

export function polylineDistanceKm(points: LatLng[]) {
  if (points.length < 2) {
    return 0;
  }

  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t
  };
}

export function offsetPerpendicularKm(
  start: LatLng,
  end: LatLng,
  t: number,
  perpendicularKm: number
) {
  const base = interpolate(start, end, t);
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const length = Math.hypot(dx, dy) || 1;
  const perpLng = -dy / length;
  const perpLat = dx / length;
  const degreesPerKmLat = 1 / 111;
  const degreesPerKmLng = 1 / (111 * Math.cos(toRadians(base.lat)));

  return {
    lat: base.lat + perpLat * perpendicularKm * degreesPerKmLat,
    lng: base.lng + perpLng * perpendicularKm * degreesPerKmLng
  };
}

export function roundToFiveMinutes(date = new Date()) {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  const minutes = copy.getMinutes();
  copy.setMinutes(Math.round(minutes / 5) * 5);
  return copy;
}

export function formatIsoLocal(date: Date) {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
