import { railStationSeeds } from "../src/lib/anchors.js";
import { haversineKm } from "../src/lib/geo.js";
import { homewardScore, medianHomeCentre } from "../src/lib/homeward.js";
import {
  getVerifiedNetwork,
  listVerifiedBusAnchors,
  listVerifiedCandidatePoints,
  measureRouteCoverage
} from "../src/lib/verifiedNetwork.js";
import type {
  CandidateEvaluation,
  LatLng,
  RouteCandidate,
  RouteSearchRequest,
  RoutingProfile,
  TransportAnchor,
  ZoneDiscoveryStatus
} from "../src/types.js";

type RouteResponse = {
  geometry: LatLng[];
  graphEdgeIds?: string[];
  distanceKm: number;
  durationMinutes: number;
};

type DiscoveryDeps = {
  maxDiscoveryEndpoints?: number;
  routingProfiles?: RoutingProfile[];
  fetchRoute: (input: {
    start: LatLng;
    end: LatLng;
    profile: RoutingProfile;
  }) => Promise<RouteResponse | null>;
};

export type DiscoveryResult = {
  routes: RouteCandidate[];
  diagnostics: CandidateEvaluation[];
  zoneStatuses: ZoneDiscoveryStatus[];
  liveDiscoveryStatus: "available" | "partial" | "unavailable";
  graphVersion: string;
};

type GenericJob = {
  type: "generic";
  id: string;
  point: LatLng;
  nearbyFeatureIds: string[];
};

const MIN_ROUTE_DISTANCE_KM = 5;
const MAX_GENERIC_DISTANCE_KM = 35;
const MAX_DISCOVERY_ENDPOINTS = 18;
const DISCOVERY_BATCH_SIZE = 5;
const VERIFIED_COVERAGE_MINIMUM = 0.55;
const MIXED_TRAFFIC_MAXIMUM = 1200;
const ROUTING_PROFILES: RoutingProfile[] = ["official_protected", "official_quiet", "bicycle"];

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
  if (distanceKm < 10) {
    return 0;
  }
  if (distanceKm < 20) {
    return 1;
  }
  return 2;
}

function buildGenericJobs(start: LatLng, riderAnchors: LatLng[]): GenericJob[] {
  const homeCentre = medianHomeCentre(riderAnchors);
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

  return ordered.sort((left, right) => {
    const leftScore = homewardScore(start, left.point, homeCentre);
    const rightScore = homewardScore(start, right.point, homeCentre);
    const leftHomeward = leftScore >= -0.1 ? 0 : 1;
    const rightHomeward = rightScore >= -0.1 ? 0 : 1;
    return (
      leftHomeward - rightHomeward ||
      haversineKm(left.point, homeCentre) - haversineKm(right.point, homeCentre) ||
      left.id.localeCompare(right.id)
    );
  });
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

function buildGenericCandidate(
  job: GenericJob,
  route: RouteResponse,
  profile: RoutingProfile,
  requireOfficialCoverage = true
) {
  const endpointAnchor = nearestEligibleAnchor(job.point);
  if (!endpointAnchor.eligible || !endpointAnchor.anchor) {
    return null;
  }

  const { coverage, eligible } = qualityGate(route.geometry);
  if (requireOfficialCoverage && !eligible) {
    return null;
  }

  const candidate: RouteCandidate = {
    id: job.id,
    source: "verified-network",
    origin: "network-endpoint",
    profile,
    routeName: `${endpointAnchor.anchor.name} verified route`,
    endpointName: endpointAnchor.anchor.name,
    endpoint: job.point,
    endpointAnchor: endpointAnchor.anchor,
    geometry: route.geometry,
    graphEdgeIds: route.graphEdgeIds,
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

async function runJob(job: GenericJob, start: LatLng, deps: DiscoveryDeps) {
  const routingProfiles = deps.routingProfiles ?? ROUTING_PROFILES;
  for (const profile of routingProfiles) {
    const route = await deps.fetchRoute({ start, end: job.point, profile }).catch(() => null);
    if (
      !route ||
      route.distanceKm < MIN_ROUTE_DISTANCE_KM ||
      route.distanceKm > MAX_GENERIC_DISTANCE_KM
    ) {
      continue;
    }
    const candidate = buildGenericCandidate(job, route, profile);
    if (candidate) {
      return [candidate];
    }
  }
  return [];
}

export async function discoverCyclingRoutes(
  request: RouteSearchRequest,
  deps: DiscoveryDeps
): Promise<DiscoveryResult> {
  const genericJobs = buildGenericJobs(
    request.start.point,
    request.participants.map((participant) => participant.anchor.point)
  );
  // Named source lines are overlays, not physical topology. They may be re-enabled only
  // after import produces continuous, directed GraphHopper edge sequences.
  const pageJobs = genericJobs.slice(0, deps.maxDiscoveryEndpoints ?? MAX_DISCOVERY_ENDPOINTS);
  const networkVersion = getVerifiedNetwork().version;

  if (pageJobs.length === 0) {
    return {
      routes: [],
      diagnostics: [],
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
      graphVersion: networkVersion
    };
  }

  const routes: RouteCandidate[] = [];
  const diagnostics: CandidateEvaluation[] = [];

  for (let index = 0; index < pageJobs.length; index += DISCOVERY_BATCH_SIZE) {
    const batch = pageJobs.slice(index, index + DISCOVERY_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (job) => {
        const candidates = await runJob(job, request.start.point, deps);
        if (candidates.length === 0) {
          diagnostics.push({ candidateId: job.id, accepted: false, reason: "route_or_quality_gate" });
        } else {
          diagnostics.push(...candidates.map((candidate) => ({ candidateId: candidate.id, accepted: true })));
        }
        return candidates;
      })
    );

    for (const result of batchResults) {
      routes.push(...result);
    }
  }

  if (routes.length === 0) {
    const attempted = new Set(pageJobs.map((job) => job.id));
    for (const job of genericJobs) {
      if (attempted.has(job.id) || !nearestEligibleAnchor(job.point).eligible) {
        continue;
      }
      const route = await deps
        .fetchRoute({ start: request.start.point, end: job.point, profile: "bicycle" })
        .catch(() => null);
      if (!route || route.distanceKm < MIN_ROUTE_DISTANCE_KM || route.distanceKm > MAX_GENERIC_DISTANCE_KM) {
        continue;
      }
      const fallback = buildGenericCandidate(job, route, "bicycle", false);
      if (fallback) {
        routes.push(fallback);
        diagnostics.push({ candidateId: fallback.id, accepted: true, reason: "all_bicycle_fallback" });
        break;
      }
    }
  }

  const liveDiscoveryStatus =
    routes.length === 0
      ? "unavailable"
      : diagnostics.some((diagnostic) => !diagnostic.accepted)
        ? "partial"
        : "available";

  return {
    routes: routes.sort(
      (left, right) =>
        (right.routeQualityScore ?? 0) - (left.routeQualityScore ?? 0) || left.distanceKm - right.distanceKm
    ),
    diagnostics,
    zoneStatuses: [
      {
        zoneId: "verified-network",
        zoneName: "Verified network",
        status:
          liveDiscoveryStatus,
        usedProfile: "cycling",
        candidateCount: routes.length,
        reason:
          routes.length === 0
            ? "No routed candidates stayed on the verified cycling network strongly enough."
            : undefined
      } satisfies ZoneDiscoveryStatus
    ],
    liveDiscoveryStatus,
    graphVersion: networkVersion
  };
}
