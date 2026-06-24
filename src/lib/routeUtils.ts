import type { LatLng, RouteCandidate } from "../types.js";

export const MAX_ROUTE_SIGNATURE_SEGMENTS = 160;

function formatSegment(previous: LatLng, current: LatLng) {
  return `${previous.lat.toFixed(3)},${previous.lng.toFixed(3)}->${current.lat.toFixed(
    3
  )},${current.lng.toFixed(3)}`;
}

function signatureSegmentIndexes(segmentCount: number, maxSegments: number) {
  if (segmentCount <= 0) {
    return [];
  }
  if (maxSegments <= 1) {
    return [1];
  }
  if (segmentCount <= maxSegments) {
    return Array.from({ length: segmentCount }, (_, index) => index + 1);
  }

  const indexes = new Set<number>();
  for (let slot = 0; slot < maxSegments; slot += 1) {
    indexes.add(1 + Math.round((slot * (segmentCount - 1)) / (maxSegments - 1)));
  }

  let fallback = 1;
  while (indexes.size < maxSegments) {
    indexes.add(fallback);
    fallback += 1;
  }

  return [...indexes].sort((left, right) => left - right);
}

export function routeSignature(points: LatLng[], maxSegments = MAX_ROUTE_SIGNATURE_SEGMENTS) {
  const segmentCount = Math.max(0, points.length - 1);
  const boundedMaxSegments = Math.max(1, maxSegments);
  const indexes = signatureSegmentIndexes(segmentCount, boundedMaxSegments);
  const signature: string[] = [];
  for (const index of indexes) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) {
      continue;
    }
    signature.push(formatSegment(previous, current));
  }
  return signature;
}

export function routeQualityScore(candidate: RouteCandidate) {
  const verifiedCoverage = candidate.verifiedCoverage ?? 0;
  const protectedCoverage = (candidate.pcnCoverage ?? 0) + (candidate.cyclingPathCoverage ?? 0);
  const mixedTrafficPenalty = (candidate.mixedTrafficMeters ?? 0) / 80;
  return Math.round(verifiedCoverage * 70 + protectedCoverage * 20 - mixedTrafficPenalty);
}
