import { clamp, haversineKm } from "./geo.js";
import type { LatLng, TransitTimeQuery } from "../types.js";

function timeOfDayPenalty(departureIso: string) {
  const departure = new Date(departureIso);
  if (Number.isNaN(departure.getTime())) {
    return 0;
  }
  const hour = Number.parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      hour: "2-digit",
      hour12: false
    }).format(departure),
    10
  );
  if (hour >= 23 || hour < 6) {
    return 12;
  }
  if ((hour >= 7 && hour < 9) || (hour >= 18 && hour < 20)) {
    return 6;
  }
  return 0;
}

export function estimateTransitMinutes(query: TransitTimeQuery) {
  const distanceKm = haversineKm(query.from, query.to);
  const baseSpeedKmh = query.modeHint === "rail" ? 26 : 22;
  const walkPenalty = query.modeHint === "rail" ? 8 : 5;
  const transferPenalty = query.modeHint === "rail" ? clamp(5 + distanceKm * 0.35, 5, 16) : 2;
  const routePenalty = query.modeHint === "rail" ? clamp(distanceKm * 0.5, 1, 18) : clamp(distanceKm * 0.35, 1, 8);

  return Math.round(
    (distanceKm / baseSpeedKmh) * 60 +
      walkPenalty +
      transferPenalty +
      routePenalty +
      timeOfDayPenalty(query.departureIso)
  );
}

export function estimateTransitMinutesBetween(
  from: LatLng,
  to: LatLng,
  departureIso: string,
  modeHint: "rail" | "bus"
) {
  return estimateTransitMinutes({ from, to, departureIso, modeHint });
}
