import { anchorSeeds } from "../data/anchors.js";
import { haversineKm } from "./geo.js";
import { normalizeStationQuery, stationNameMatchesQuery } from "./stationMatching.js";
import type { LatLng, LocationResolution, TransportAnchor } from "../types.js";

export const railStationSeeds = anchorSeeds.filter((anchor) => anchor.kind === "rail");
const OFFSHORE_SNAP_KM = 1.5;

export function findRailStation(query: string) {
  const normalized = normalizeStationQuery(query);
  if (!normalized) {
    return null;
  }

  return railStationSeeds.find((anchor) => stationNameMatchesQuery(anchor.name, normalized)) ?? null;
}

export function resolveRailStationAnchor(
  query: string,
  resolution: LocationResolution | null = null
): TransportAnchor {
  const matchedStation = findRailStation(query);

  if (matchedStation) {
    return {
      id: matchedStation.id,
      name: matchedStation.name,
      kind: "rail",
      point: matchedStation.point,
      distanceFromHomeKm: 0,
      fallbackSuggested: false
    };
  }

  return {
    id: `rail-${query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "station"}`,
    name: resolution?.label || query.trim() || "Selected station",
    kind: "rail",
    point: resolution?.point ?? { lat: 1.3521, lng: 103.8198 },
    distanceFromHomeKm: 0,
    fallbackSuggested: false
  };
}

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

export function snapMeetupPointToLand(point: LatLng, label: string) {
  const nearestAnchor = anchorSeeds
    .map((anchor) => ({
      anchor,
      distanceKm: haversineKm(point, anchor.point)
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  if (!nearestAnchor || nearestAnchor.distanceKm <= OFFSHORE_SNAP_KM) {
    return {
      label,
      point,
      snapped: false
    };
  }

  return {
    label: `Near ${nearestAnchor.anchor.name}`,
    point: nearestAnchor.anchor.point,
    snapped: true
  };
}
