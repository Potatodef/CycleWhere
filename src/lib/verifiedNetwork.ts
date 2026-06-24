import verifiedNetworkJson from "../../public/data/verified-network.json";
import type {
  LatLng,
  VerifiedNamedRoute,
  VerifiedNetworkBusAnchor,
  VerifiedNetworkCoveragePoint,
  VerifiedNetworkData,
  VerifiedNetworkKind
} from "../types.js";
import { haversineKm } from "./geo.js";

const verifiedNetwork = verifiedNetworkJson as VerifiedNetworkData;
const REFERENCE_LAT = 1.3521;
const METERS_PER_LAT = 111320;
const METERS_PER_LNG = 111320 * Math.cos((REFERENCE_LAT * Math.PI) / 180);
const COVERAGE_RADIUS_METERS = 35;
const COVERAGE_GRID_METERS = 70;
export const MAX_COVERAGE_SAMPLES = 500;
const COVERAGE_SAMPLE_SPACING_KM = 0.05;

type IndexedCoveragePoint = VerifiedNetworkCoveragePoint & {
  x: number;
  y: number;
};

function toMeters(point: LatLng) {
  return {
    x: point.lng * METERS_PER_LNG,
    y: point.lat * METERS_PER_LAT
  };
}

function gridKey(x: number, y: number) {
  return `${Math.floor(x / COVERAGE_GRID_METERS)}:${Math.floor(y / COVERAGE_GRID_METERS)}`;
}

function buildCoverageGrid(points: VerifiedNetworkCoveragePoint[]) {
  const grid = new Map<string, IndexedCoveragePoint[]>();

  for (const point of points) {
    const projected = toMeters(point.point);
    const indexed = {
      ...point,
      x: projected.x,
      y: projected.y
    };
    const key = gridKey(indexed.x, indexed.y);
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(indexed);
    } else {
      grid.set(key, [indexed]);
    }
  }

  return grid;
}

const coverageGrid = buildCoverageGrid(verifiedNetwork.coveragePoints);
const dedupedBusAnchors = [...verifiedNetwork.busAnchors]
  .sort((left, right) => left.id.localeCompare(right.id) || left.name.localeCompare(right.name))
  .reduce<VerifiedNetworkBusAnchor[]>((anchors, anchor) => {
    if (!anchors.some((existing) => existing.id === anchor.id)) {
      anchors.push(anchor);
    }
    return anchors;
  }, []);

export function sampleRouteCoveragePoints(
  points: LatLng[],
  spacingKm = COVERAGE_SAMPLE_SPACING_KM,
  maxSamples = MAX_COVERAGE_SAMPLES
) {
  const boundedMaxSamples = Math.max(2, Math.floor(maxSamples));
  if (points.length < 2) {
    return {
      points: [...points],
      distanceKm: 0
    };
  }

  const segmentDistances: number[] = [];
  let totalDistanceKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentDistance = haversineKm(points[index - 1], points[index]);
    segmentDistances.push(segmentDistance);
    totalDistanceKm += segmentDistance;
  }

  if (totalDistanceKm <= 0) {
    return {
      points: [points[0]!, points[points.length - 1]!],
      distanceKm: 0
    };
  }

  const intervalCount = Math.max(
    1,
    Math.min(boundedMaxSamples - 1, Math.ceil(totalDistanceKm / spacingKm))
  );
  const sampleSpacingKm = totalDistanceKm / intervalCount;
  const sampled: LatLng[] = [points[0]!];
  let segmentIndex = 0;
  let distanceBeforeSegmentKm = 0;

  for (let step = 1; step < intervalCount; step += 1) {
    const targetDistanceKm = sampleSpacingKm * step;
    while (
      segmentIndex < segmentDistances.length - 1 &&
      distanceBeforeSegmentKm + (segmentDistances[segmentIndex] ?? 0) < targetDistanceKm
    ) {
      distanceBeforeSegmentKm += segmentDistances[segmentIndex] ?? 0;
      segmentIndex += 1;
    }

    const segmentStart = points[segmentIndex]!;
    const segmentEnd = points[segmentIndex + 1]!;
    const segmentDistanceKm = segmentDistances[segmentIndex] ?? 0;
    const distanceIntoSegmentKm = targetDistanceKm - distanceBeforeSegmentKm;
    const ratio = segmentDistanceKm <= 0 ? 0 : distanceIntoSegmentKm / segmentDistanceKm;
    sampled.push(interpolatePoint(segmentStart, segmentEnd, ratio));
  }

  sampled.push(points[points.length - 1]!);
  return {
    points: sampled,
    distanceKm: totalDistanceKm
  };
}

function interpolatePoint(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t
  };
}

export function listVerifiedCandidatePoints() {
  return verifiedNetwork.candidatePoints;
}

export function getVerifiedNetwork() {
  return verifiedNetwork;
}

export function listVerifiedBusAnchors(): VerifiedNetworkBusAnchor[] {
  return dedupedBusAnchors;
}

export function listVerifiedNamedRoutes(): VerifiedNamedRoute[] {
  return verifiedNetwork.namedRoutes;
}

export function measureRouteCoverage(routeGeometry: LatLng[]) {
  const { points: routePoints, distanceKm: routeDistanceKm } = sampleRouteCoveragePoints(routeGeometry);
  let verifiedPoints = 0;
  let pcnPoints = 0;
  let cyclingPathPoints = 0;
  const sourceDatasets = new Set<string>();
  const sourceFeatureIds = new Set<string>();

  for (const point of routePoints) {
    const projected = toMeters(point);
    const cellX = Math.floor(projected.x / COVERAGE_GRID_METERS);
    const cellY = Math.floor(projected.y / COVERAGE_GRID_METERS);
    const matches: IndexedCoveragePoint[] = [];

    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        const bucket = coverageGrid.get(`${x}:${y}`);
        if (!bucket) {
          continue;
        }
        for (const candidate of bucket) {
          if (Math.abs(candidate.x - projected.x) > COVERAGE_RADIUS_METERS) {
            continue;
          }
          if (Math.abs(candidate.y - projected.y) > COVERAGE_RADIUS_METERS) {
            continue;
          }
          if (haversineKm(point, candidate.point) * 1000 <= COVERAGE_RADIUS_METERS) {
            matches.push(candidate);
          }
        }
      }
    }

    if (matches.length === 0) {
      continue;
    }

    verifiedPoints += 1;
    let matchedPcn = false;
    let matchedCyclingPath = false;

    for (const match of matches) {
      sourceDatasets.add(match.sourceDataset);
      sourceFeatureIds.add(match.sourceFeatureId);
      if (match.kind === "park-connector") {
        matchedPcn = true;
      }
      if (match.kind === "cycling-path") {
        matchedCyclingPath = true;
      }
    }

    if (matchedPcn) {
      pcnPoints += 1;
    }
    if (matchedCyclingPath) {
      cyclingPathPoints += 1;
    }
  }

  const totalPoints = Math.max(1, routePoints.length);
  const verifiedCoverage = verifiedPoints / totalPoints;

  return {
    verifiedCoverage,
    pcnCoverage: pcnPoints / totalPoints,
    cyclingPathCoverage: cyclingPathPoints / totalPoints,
    mixedTrafficMeters: Math.round(routeDistanceKm * 1000 * (1 - verifiedCoverage)),
    sourceDatasets: [...sourceDatasets].sort(),
    sourceFeatureIds: [...sourceFeatureIds].sort()
  };
}

export function hasSourceKind(sourceKinds: VerifiedNetworkKind[], kind: VerifiedNetworkKind) {
  return sourceKinds.includes(kind);
}
