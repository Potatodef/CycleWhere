import type { LatLng } from "../types.js";

const SEMI_MAJOR_AXIS = 6378137;
const FLATTENING = 1 / 298.257223563;
const ORIGIN_LATITUDE = (1 + 22 / 60) * (Math.PI / 180);
const ORIGIN_LONGITUDE = (103 + 50 / 60) * (Math.PI / 180);
const FALSE_NORTHING = 38744.572;
const FALSE_EASTING = 28001.642;

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function medianHomeCentre(points: LatLng[]) {
  if (points.length === 0) {
    throw new Error("At least one rider anchor is required.");
  }
  return {
    lat: median(points.map((point) => point.lat)),
    lng: median(points.map((point) => point.lng))
  };
}

function meridionalArc(latitude: number, eccentricitySquared: number) {
  const e4 = eccentricitySquared ** 2;
  const e6 = eccentricitySquared ** 3;
  return (
    SEMI_MAJOR_AXIS *
    ((1 - eccentricitySquared / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latitude -
      ((3 * eccentricitySquared) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) *
        Math.sin(2 * latitude) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latitude) -
      ((35 * e6) / 3072) * Math.sin(6 * latitude))
  );
}

export function projectSvy21(point: LatLng) {
  const latitude = point.lat * (Math.PI / 180);
  const longitude = point.lng * (Math.PI / 180);
  const eccentricitySquared = 2 * FLATTENING - FLATTENING ** 2;
  const secondEccentricitySquared = eccentricitySquared / (1 - eccentricitySquared);
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const tangentSquared = Math.tan(latitude) ** 2;
  const c = secondEccentricitySquared * cosLatitude ** 2;
  const a = (longitude - ORIGIN_LONGITUDE) * cosLatitude;
  const radius = SEMI_MAJOR_AXIS / Math.sqrt(1 - eccentricitySquared * sinLatitude ** 2);
  const arcDelta =
    meridionalArc(latitude, eccentricitySquared) -
    meridionalArc(ORIGIN_LATITUDE, eccentricitySquared);

  return {
    east:
      FALSE_EASTING +
      radius *
        (a +
          ((1 - tangentSquared + c) * a ** 3) / 6 +
          ((5 - 18 * tangentSquared + tangentSquared ** 2 + 72 * c - 58 * secondEccentricitySquared) *
            a ** 5) /
            120),
    north:
      FALSE_NORTHING +
      arcDelta +
      radius *
        Math.tan(latitude) *
        (a ** 2 / 2 +
          ((5 - tangentSquared + 9 * c + 4 * c ** 2) * a ** 4) / 24 +
          ((61 - 58 * tangentSquared + tangentSquared ** 2 + 600 * c - 330 * secondEccentricitySquared) *
            a ** 6) /
            720)
  };
}

export function homewardScore(start: LatLng, endpoint: LatLng, homeCentre: LatLng) {
  const projectedStart = projectSvy21(start);
  const projectedEndpoint = projectSvy21(endpoint);
  const projectedHome = projectSvy21(homeCentre);
  const homeVector = {
    east: projectedHome.east - projectedStart.east,
    north: projectedHome.north - projectedStart.north
  };
  const endpointVector = {
    east: projectedEndpoint.east - projectedStart.east,
    north: projectedEndpoint.north - projectedStart.north
  };
  const homeLength = Math.hypot(homeVector.east, homeVector.north);
  const endpointLength = Math.hypot(endpointVector.east, endpointVector.north);
  if (homeLength < 1000 || endpointLength === 0) {
    return 0;
  }
  return (
    (homeVector.east * endpointVector.east + homeVector.north * endpointVector.north) /
    (homeLength * endpointLength)
  );
}
