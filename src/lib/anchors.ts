import { anchorSeeds } from "../data/anchors.js";
import { haversineKm } from "./geo.js";
import type { LatLng, TransportAnchor } from "../types.js";

export function resolveTransportAnchor(home: LatLng): TransportAnchor {
  const rails = anchorSeeds.filter((anchor) => anchor.kind === "rail");
  const buses = anchorSeeds.filter((anchor) => anchor.kind === "bus");

  const nearestRail = rails
    .map((anchor) => ({
      anchor,
      distanceKm: haversineKm(home, anchor.point)
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  const nearestBus = buses
    .map((anchor) => ({
      anchor,
      distanceKm: haversineKm(home, anchor.point)
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  if (!nearestRail) {
    return {
      id: nearestBus.anchor.id,
      name: nearestBus.anchor.name,
      kind: nearestBus.anchor.kind,
      point: nearestBus.anchor.point,
      distanceFromHomeKm: nearestBus.distanceKm,
      fallbackSuggested: false
    };
  }

  const fallbackSuggested = nearestRail.distanceKm > 2.5 && Boolean(nearestBus);
  return {
    id: fallbackSuggested ? nearestBus.anchor.id : nearestRail.anchor.id,
    name: fallbackSuggested ? nearestBus.anchor.name : nearestRail.anchor.name,
    kind: fallbackSuggested ? nearestBus.anchor.kind : nearestRail.anchor.kind,
    point: fallbackSuggested ? nearestBus.anchor.point : nearestRail.anchor.point,
    distanceFromHomeKm: fallbackSuggested
      ? nearestBus.distanceKm
      : nearestRail.distanceKm,
    fallbackSuggested,
    fallbackAnchor: fallbackSuggested
      ? {
          id: nearestRail.anchor.id,
          name: nearestRail.anchor.name,
          kind: nearestRail.anchor.kind,
          point: nearestRail.anchor.point,
          distanceFromHomeKm: nearestRail.distanceKm
        }
      : undefined
  };
}
