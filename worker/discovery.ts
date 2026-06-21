import { railStationSeeds } from "../src/lib/anchors.js";
import { haversineKm, polylineDistanceKm } from "../src/lib/geo.js";
import {
  getVerifiedNetwork,
  listVerifiedBusAnchors,
  listVerifiedCandidatePoints,
  listVerifiedNamedRoutes,
  measureRouteCoverage
} from "../src/lib/verifiedNetwork.js";
import type {
  DiscoverRoutesRequest,
  DiscoveredRoutesResponse,
  LatLng,
  RouteCandidate,
  RoutingProfile,
  TransportAnchor,
  VerifiedNamedRoute,
  ZoneDiscoveryStatus
} from "../src/types.js";

type RouteResponse = {
  geometry: LatLng[];
  distanceKm: number;
  durationMinutes: number;
};

type DiscoveryDeps = {
  fetchRoute: (input: {
    start: LatLng;
    end: LatLng;
    profile: RoutingProfile;
  }) => Promise<RouteResponse | null>;
};

type GenericJob = {
  type: "generic";
  id: string;
  point: LatLng;
  nearbyFeatureIds: string[];
};

type NamedRouteJob = {
  type: "named";
  id: string;
  route: VerifiedNamedRoute;
  entryPoint: LatLng;
  endpoint: LatLng;
  straightLineDistanceKm: number;
};

type DiscoveryJob = GenericJob | NamedRouteJob;

const MIN_ROUTE_DISTANCE_KM = 3;
const MAX_GENERIC_DISTANCE_KM = 35;
const GENERIC_PAGE_SIZE = 20;
const DISCOVERY_BATCH_SIZE = 5;
const VERIFIED_COVERAGE_MINIMUM = 0.55;
const MIXED_TRAFFIC_MAXIMUM = 1200;
const NAMED_ROUTE_ENTRY_MAX_KM = 5;
const NAMED_ROUTE_ACCESS_MAX_KM = 8;
const NAMED_ROUTE_TARGETS_KM = [10, 20, 35];

function routeSignature(points: LatLng[]) {
  const signature = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    signature.push(
      `${previous.lat.toFixed(3)},${previous.lng.toFixed(3)}->${current.lat.toFixed(
        3
      )},${current.lng.toFixed(3)}`
    );
  }
  return signature;
}

function routeQualityScore(candidate: RouteCandidate) {
  const verifiedCoverage = candidate.verifiedCoverage ?? 0;
  const protectedCoverage = (candidate.pcnCoverage ?? 0) + (candidate.cyclingPathCoverage ?? 0);
  const mixedTrafficPenalty = (candidate.mixedTrafficMeters ?? 0) / 80;
  return Math.round(verifiedCoverage * 70 + protectedCoverage * 20 - mixedTrafficPenalty);
}

function nearestEligibleAnchor(point: LatLng) {
  const nearestRail = railStationSeeds
    .map((anchor) => ({ anchor, distanceKm: haversineKm(point, anchor.point) }))
    .sort((left, right) => left.distanceKm - right.distanceKm)[0];
  const nearestBus = listVerifiedBusAnchors()
    .map((anchor) => ({ anchor, distanceKm: haversineKm(point, anchor.point) }))
    .sort((left, right) => left.distanceKm - right.distanceKm)[0];

  if (nearestRail && nearestRail.distanceKm <= 1) {
    return {
      anchor: {
        id: nearestRail.anchor.id,
        name: nearestRail.anchor.name,
        kind: "rail" as const,
        point: nearestRail.anchor.point,
        distanceFromHomeKm: nearestRail.distanceKm,
        fallbackSuggested: false
      },
      eligible: true
    };
  }

  if (nearestBus && nearestBus.distanceKm <= 0.4) {
    return {
      anchor: {
        id: nearestBus.anchor.id,
        name: nearestBus.anchor.name,
        kind: "bus" as const,
        point: nearestBus.anchor.point,
        distanceFromHomeKm: nearestBus.distanceKm,
        fallbackSuggested: false
      },
      eligible: true
    };
  }

  return {
    anchor: null,
    eligible: false
  };
}

function bearingDegrees(start: LatLng, end: LatLng) {
  const y = Math.sin(((end.lng - start.lng) * Math.PI) / 180) * Math.cos((end.lat * Math.PI) / 180);
  const x =
    Math.cos((start.lat * Math.PI) / 180) * Math.sin((end.lat * Math.PI) / 180) -
    Math.sin((start.lat * Math.PI) / 180) *
      Math.cos((end.lat * Math.PI) / 180) *
      Math.cos(((end.lng - start.lng) * Math.PI) / 180);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

function sectorIndex(start: LatLng, end: LatLng) {
  return Math.floor(((bearingDegrees(start, end) + 22.5) % 360) / 45);
}

function distanceBandIndex(distanceKm: number) {
  if (distanceKm < 8) {
    return 0;
  }
  if (distanceKm < 15) {
    return 1;
  }
  if (distanceKm < 25) {
    return 2;
  }
  return 3;
}

function buildGenericJobs(start: LatLng): GenericJob[] {
  const groups = new Map<string, Array<{ point: LatLng; id: string; nearbyFeatureIds: string[]; distanceKm: number }>>();

  for (const candidatePoint of listVerifiedCandidatePoints()) {
    const distanceKm = haversineKm(start, candidatePoint.point);
    if (distanceKm < MIN_ROUTE_DISTANCE_KM || distanceKm > MAX_GENERIC_DISTANCE_KM) {
      continue;
    }
    const key = `${distanceBandIndex(distanceKm)}:${sectorIndex(start, candidatePoint.point)}`;
    const group = groups.get(key);
    const item = {
      point: candidatePoint.point,
      id: candidatePoint.id,
      nearbyFeatureIds: candidatePoint.nearbyFeatureIds,
      distanceKm
    };
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  for (const group of groups.values()) {
    group.sort((left, right) => left.distanceKm - right.distanceKm || left.id.localeCompare(right.id));
  }

  const ordered: GenericJob[] = [];
  let appended = true;
  while (appended) {
    appended = false;
    for (let band = 0; band < 4; band += 1) {
      for (let sector = 0; sector < 8; sector += 1) {
        const key = `${band}:${sector}`;
        const group = groups.get(key);
        if (!group?.length) {
          continue;
        }
        const next = group.shift();
        if (!next) {
          continue;
        }
        appended = true;
        ordered.push({
          type: "generic",
          id: next.id,
          point: next.point,
          nearbyFeatureIds: next.nearbyFeatureIds
        });
      }
    }
  }

  return ordered;
}

function buildNamedRouteJobs(start: LatLng): NamedRouteJob[] {
  return listVerifiedNamedRoutes()
    .map((route) => {
      const firstPoint = route.geometry[0];
      const lastPoint = route.geometry[route.geometry.length - 1];
      const firstDistanceKm = haversineKm(start, firstPoint);
      const lastDistanceKm = haversineKm(start, lastPoint);
      const useFirst = firstDistanceKm <= lastDistanceKm;
      return {
        type: "named" as const,
        id: route.id,
        route,
        entryPoint: useFirst ? firstPoint : lastPoint,
        endpoint: useFirst ? lastPoint : firstPoint,
        straightLineDistanceKm: Math.min(firstDistanceKm, lastDistanceKm)
      };
    })
    .filter((job) => job.straightLineDistanceKm <= NAMED_ROUTE_ENTRY_MAX_KM)
    .sort(
      (left, right) =>
        left.straightLineDistanceKm - right.straightLineDistanceKm || left.route.id.localeCompare(right.route.id)
    );
}

function interleaveJobs(genericJobs: GenericJob[], namedJobs: NamedRouteJob[]) {
  const jobs: DiscoveryJob[] = [];
  let genericIndex = 0;
  let namedIndex = 0;

  while (genericIndex < genericJobs.length || namedIndex < namedJobs.length) {
    for (let count = 0; count < 2 && genericIndex < genericJobs.length; count += 1) {
      jobs.push(genericJobs[genericIndex]);
      genericIndex += 1;
    }

    if (namedIndex < namedJobs.length) {
      jobs.push(namedJobs[namedIndex]);
      namedIndex += 1;
    }

    if (genericIndex >= genericJobs.length && namedIndex < namedJobs.length) {
      jobs.push(...namedJobs.slice(namedIndex));
      break;
    }
  }

  return jobs;
}

function qualityGate(geometry: LatLng[]) {
  const coverage = measureRouteCoverage(geometry);
  return {
    coverage,
    eligible:
      coverage.verifiedCoverage >= VERIFIED_COVERAGE_MINIMUM &&
      coverage.mixedTrafficMeters <= MIXED_TRAFFIC_MAXIMUM
  };
}

function buildGenericCandidate(job: GenericJob, route: RouteResponse) {
  const endpointAnchor = nearestEligibleAnchor(job.point);
  if (!endpointAnchor.eligible || !endpointAnchor.anchor) {
    return null;
  }

  const { coverage, eligible } = qualityGate(route.geometry);
  if (!eligible) {
    return null;
  }

  const candidate: RouteCandidate = {
    id: job.id,
    source: "verified-network",
    origin: "network-endpoint",
    profile: "cycling",
    routeName: `${endpointAnchor.anchor.name} verified route`,
    endpointName: endpointAnchor.anchor.name,
    endpoint: job.point,
    endpointAnchor: endpointAnchor.anchor,
    geometry: route.geometry,
    distanceKm: route.distanceKm,
    cyclingMinutes: route.durationMinutes,
    verifiedCoverage: coverage.verifiedCoverage,
    pcnCoverage: coverage.pcnCoverage,
    cyclingPathCoverage: coverage.cyclingPathCoverage,
    mixedTrafficMeters: coverage.mixedTrafficMeters,
    sourceDatasets: coverage.sourceDatasets,
    sourceFeatureIds: coverage.sourceFeatureIds.length
      ? coverage.sourceFeatureIds
      : job.nearbyFeatureIds,
    routeQualityScore: null,
    routeQualitySource: "measured",
    overlapSignature: routeSignature(route.geometry),
    cyclingMinutesSource: "onemap"
  };

  candidate.routeQualityScore = routeQualityScore(candidate);
  return candidate;
}

function slicePolyline(points: LatLng[], maxDistanceKm: number) {
  if (points.length < 2) {
    return points.slice();
  }

  const sliced = [points[0]];
  let coveredKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentStart = points[index - 1];
    const segmentEnd = points[index];
    const segmentDistanceKm = haversineKm(segmentStart, segmentEnd);

    if (coveredKm + segmentDistanceKm <= maxDistanceKm) {
      sliced.push(segmentEnd);
      coveredKm += segmentDistanceKm;
      continue;
    }

    const remainingKm = maxDistanceKm - coveredKm;
    if (remainingKm > 0 && segmentDistanceKm > 0) {
      const ratio = remainingKm / segmentDistanceKm;
      sliced.push({
        lat: segmentStart.lat + (segmentEnd.lat - segmentStart.lat) * ratio,
        lng: segmentStart.lng + (segmentEnd.lng - segmentStart.lng) * ratio
      });
    }
    return sliced;
  }

  return sliced;
}

function joinGeometry(accessGeometry: LatLng[], routeGeometry: LatLng[]) {
  if (accessGeometry.length === 0) {
    return routeGeometry.slice();
  }
  if (routeGeometry.length === 0) {
    return accessGeometry.slice();
  }

  const accessEnd = accessGeometry[accessGeometry.length - 1];
  const routeStart = routeGeometry[0];
  const routeTail =
    haversineKm(accessEnd, routeStart) <= 0.05 ? routeGeometry.slice(1) : routeGeometry.slice();
  return accessGeometry.concat(routeTail);
}

function estimateNamedRouteMinutes(routeDistanceKm: number, surface: "paved" | "mixed") {
  const speedKmPerHour = surface === "mixed" ? 10 : 16;
  return Math.max(1, Math.round((routeDistanceKm / speedKmPerHour) * 60));
}

function buildNamedCandidates(job: NamedRouteJob, accessRoute: RouteResponse) {
  const accessQuality = qualityGate(accessRoute.geometry);
  if (!accessQuality.eligible || accessRoute.distanceKm > NAMED_ROUTE_ACCESS_MAX_KM) {
    return [];
  }

  const orientedGeometry =
    haversineKm(job.entryPoint, job.route.geometry[0]) <= haversineKm(job.entryPoint, job.route.geometry[job.route.geometry.length - 1])
      ? job.route.geometry
      : job.route.geometry.slice().reverse();
  const routeDistanceKm = polylineDistanceKm(orientedGeometry);
  const targetDistances = NAMED_ROUTE_TARGETS_KM.filter(
    (distanceKm) => distanceKm < routeDistanceKm && distanceKm >= MIN_ROUTE_DISTANCE_KM
  ).concat(routeDistanceKm);

  return targetDistances.flatMap((targetDistanceKm) => {
    const routePortion = slicePolyline(orientedGeometry, targetDistanceKm);
    const geometry = joinGeometry(accessRoute.geometry, routePortion);
    const endpoint = geometry[geometry.length - 1];
    const endpointAnchor = nearestEligibleAnchor(endpoint);
    if (!endpointAnchor.eligible || !endpointAnchor.anchor) {
      return [];
    }

    const coverage = measureRouteCoverage(geometry);
    const candidate: RouteCandidate = {
      id: `${job.route.id}-${Math.round(targetDistanceKm * 10)}`,
      source: "verified-network",
      origin: "named-route",
      profile: "cycling",
      routeName:
        Math.abs(targetDistanceKm - routeDistanceKm) < 0.2
          ? job.route.name
          : `${job.route.name} ${Math.round(targetDistanceKm)} km section`,
      endpointName:
        Math.abs(targetDistanceKm - routeDistanceKm) < 0.2
          ? job.route.name
          : `${job.route.name} ${Math.round(targetDistanceKm)} km section`,
      endpoint,
      endpointAnchor: endpointAnchor.anchor,
      geometry,
      distanceKm: Math.round((accessRoute.distanceKm + polylineDistanceKm(routePortion)) * 10) / 10,
      cyclingMinutes:
        accessRoute.durationMinutes + estimateNamedRouteMinutes(polylineDistanceKm(routePortion), job.route.surface),
      verifiedCoverage: coverage.verifiedCoverage,
      pcnCoverage: coverage.pcnCoverage,
      cyclingPathCoverage: coverage.cyclingPathCoverage,
      mixedTrafficMeters: coverage.mixedTrafficMeters,
      sourceDatasets: [...new Set(coverage.sourceDatasets.concat(job.route.sourceDataset))].sort(),
      sourceFeatureIds: [...new Set(coverage.sourceFeatureIds.concat(job.route.sourceFeatureIds))].sort(),
      routeQualityScore: null,
      routeQualitySource: "measured",
      overlapSignature: routeSignature(geometry),
      officialRouteId: job.route.id,
      officialRouteName: job.route.name,
      officialRouteSurface: job.route.surface,
      cyclingMinutesSource: "distance-estimate"
    };

    candidate.routeQualityScore = routeQualityScore(candidate);
    return candidate;
  });
}

async function runJob(job: DiscoveryJob, start: LatLng, deps: DiscoveryDeps) {
  if (job.type === "generic") {
    const route = await deps
      .fetchRoute({
        start,
        end: job.point,
        profile: "cycling"
      })
      .catch(() => null);
    if (!route || route.distanceKm < MIN_ROUTE_DISTANCE_KM) {
      return [];
    }
    const candidate = buildGenericCandidate(job, route);
    return candidate ? [candidate] : [];
  }

  const accessRoute = await deps
    .fetchRoute({
      start,
      end: job.entryPoint,
      profile: "cycling"
    })
    .catch(() => null);
  if (!accessRoute) {
    return [];
  }

  return buildNamedCandidates(job, accessRoute);
}

export async function discoverCyclingRoutes(
  request: DiscoverRoutesRequest,
  deps: DiscoveryDeps
): Promise<DiscoveredRoutesResponse> {
  const genericJobs = buildGenericJobs(request.start.point);
  const namedJobs = buildNamedRouteJobs(request.start.point);
  const allJobs = interleaveJobs(genericJobs, namedJobs);
  const offset = Math.max(0, request.offset ?? 0);
  const pageJobs = allJobs.slice(offset, offset + GENERIC_PAGE_SIZE);
  const networkVersion = getVerifiedNetwork().version;

  if (pageJobs.length === 0) {
    return {
      candidates: [],
      curatedCandidates: [],
      zoneStatuses: [
        {
          zoneId: "verified-network",
          zoneName: "Verified network",
          status: "unavailable",
          usedProfile: "cycling",
          candidateCount: 0,
          reason: "No official-network candidates were available for this meetup point."
        } satisfies ZoneDiscoveryStatus
      ],
      liveDiscoveryStatus: "unavailable",
      networkVersion,
      nextOffset: null,
      hasMore: false
    };
  }

  const curatedCandidates: RouteCandidate[] = [];
  let failedCount = 0;

  for (let index = 0; index < pageJobs.length; index += DISCOVERY_BATCH_SIZE) {
    const batch = pageJobs.slice(index, index + DISCOVERY_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (job) => {
        const candidates = await runJob(job, request.start.point, deps);
        if (candidates.length === 0) {
          failedCount += 1;
        }
        return candidates;
      })
    );

    for (const result of batchResults) {
      curatedCandidates.push(...result);
    }
  }

  const liveDiscoveryStatus =
    curatedCandidates.length === 0
      ? "unavailable"
      : failedCount === 0
        ? "available"
        : "partial";
  const hasMore = offset + pageJobs.length < allJobs.length;

  return {
    candidates: [],
    curatedCandidates: curatedCandidates.sort(
      (left, right) =>
        (right.routeQualityScore ?? 0) - (left.routeQualityScore ?? 0) || left.distanceKm - right.distanceKm
    ),
    zoneStatuses: [
      {
        zoneId: "verified-network",
        zoneName: "Verified network",
        status:
          liveDiscoveryStatus === "available"
            ? "available"
            : liveDiscoveryStatus === "partial"
              ? "partial"
              : "unavailable",
        usedProfile: "cycling",
        candidateCount: curatedCandidates.length,
        reason:
          curatedCandidates.length === 0
            ? "No routed candidates stayed on the verified cycling network strongly enough."
            : undefined
      } satisfies ZoneDiscoveryStatus
    ],
    liveDiscoveryStatus,
    networkVersion,
    nextOffset: hasMore ? offset + pageJobs.length : null,
    hasMore
  };
}
