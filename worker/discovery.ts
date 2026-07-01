import { railStationSeeds } from "../src/lib/anchors.js";
import { haversineKm } from "../src/lib/geo.js";
import { homewardScore, medianHomeCentre } from "../src/lib/homeward.js";
import { routeOverlapRatio, routeQualityScore, routeSignature } from "../src/lib/routeUtils.js";
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
  maxDiversityBackfillEndpoints?: number;
  maxFallbackEndpoints?: number;
  minDiverseRouteBuckets?: number;
  routingProfiles?: RoutingProfile[];
  fetchRoute: (input: {
    start: LatLng;
    end: LatLng;
    profile: RoutingProfile;
  }) => Promise<RouteResponse | null>;
};

type RoutingAttemptStats = {
  attempted: number;
  systemicFailures: number;
  noRouteOrQualityMisses: number;
};

export type DiscoveryResult = {
  routes: RouteCandidate[];
  diagnostics: CandidateEvaluation[];
  zoneStatuses: ZoneDiscoveryStatus[];
  liveDiscoveryStatus: "available" | "partial" | "unavailable";
  graphVersion: string;
  routingAttemptStats: RoutingAttemptStats;
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
const MAX_DIVERSITY_BACKFILL_ENDPOINTS = 12;
const DISCOVERY_BATCH_SIZE = 5;
const MIN_DIVERSE_ROUTE_BUCKETS = 6;
const VERIFIED_COVERAGE_MINIMUM = 0.6;
const ROUTING_PROFILES: RoutingProfile[] = ["official_protected", "official_quiet", "bicycle"];
const RAIL_ANCHOR_RADIUS_KM = 1;
const BUS_ANCHOR_RADIUS_KM = 0.4;
const KM_TO_DEGREES = 1 / 110.574;

function similarCandidate(a: RouteCandidate, b: RouteCandidate) {
  const overlap = routeOverlapRatio(a, b);
  const baseDistance = Math.max(a.distanceKm, b.distanceKm, 1);
  const distanceDelta = Math.abs(a.distanceKm - b.distanceKm) / baseDistance;
  return overlap >= 0.75 && distanceDelta < 0.2;
}

function nearestEligibleAnchor(point: LatLng) {
  let nearestRail: { anchor: (typeof railStationSeeds)[number]; distanceKm: number } | null = null;
  let nearestBus: { anchor: ReturnType<typeof listVerifiedBusAnchors>[number]; distanceKm: number } | null = null;
  for (const anchor of railStationSeeds) {
    const maxDelta = RAIL_ANCHOR_RADIUS_KM * KM_TO_DEGREES * 1.2;
    if (
      Math.abs(anchor.point.lat - point.lat) > maxDelta ||
      Math.abs(anchor.point.lng - point.lng) > maxDelta
    ) {
      continue;
    }
    const distanceKm = haversineKm(point, anchor.point);
    if (!nearestRail || distanceKm < nearestRail.distanceKm) {
      nearestRail = { anchor, distanceKm };
    }
  }

  if (nearestRail && nearestRail.distanceKm <= RAIL_ANCHOR_RADIUS_KM) {
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

  for (const anchor of listVerifiedBusAnchors()) {
    const maxDelta = BUS_ANCHOR_RADIUS_KM * KM_TO_DEGREES * 1.2;
    if (
      Math.abs(anchor.point.lat - point.lat) > maxDelta ||
      Math.abs(anchor.point.lng - point.lng) > maxDelta
    ) {
      continue;
    }
    const distanceKm = haversineKm(point, anchor.point);
    if (!nearestBus || distanceKm < nearestBus.distanceKm) {
      nearestBus = { anchor, distanceKm };
    }
  }

  if (nearestBus && nearestBus.distanceKm <= BUS_ANCHOR_RADIUS_KM) {
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

function routeBucketKey(start: LatLng, point: LatLng) {
  return `${distanceBandIndex(haversineKm(start, point))}:${sectorIndex(start, point)}`;
}

function eligibleGenericJobs(jobs: GenericJob[]) {
  return jobs.filter((job) => nearestEligibleAnchor(job.point).eligible);
}

function sortRoutesForDiscoveryPage(routes: RouteCandidate[], start: LatLng) {
  const byQuality = [...routes].sort(
    (left, right) =>
      (right.routeQualityScore ?? 0) - (left.routeQualityScore ?? 0) ||
      left.distanceKm - right.distanceKm ||
      left.id.localeCompare(right.id)
  );
  const groups = new Map<string, RouteCandidate[]>();

  for (const route of byQuality) {
    const key = routeBucketKey(start, route.endpoint);
    const group = groups.get(key);
    if (group) {
      group.push(route);
    } else {
      groups.set(key, [route]);
    }
  }

  const ordered: RouteCandidate[] = [];
  const bucketKeys = [...groups.keys()];
  let appended = true;
  while (appended) {
    appended = false;
    for (const key of bucketKeys) {
      const next = groups.get(key)?.shift();
      if (!next) {
        continue;
      }
      appended = true;
      ordered.push(next);
    }
  }

  return ordered;
}

function buildGenericJobs(start: LatLng, riderAnchors: LatLng[]): GenericJob[] {
  const homeCentre = medianHomeCentre(riderAnchors);
  const groups = new Map<string, Array<{ point: LatLng; id: string; nearbyFeatureIds: string[]; distanceKm: number }>>();

  for (const candidatePoint of listVerifiedCandidatePoints()) {
    if (!nearestEligibleAnchor(candidatePoint.point).eligible) {
      continue;
    }

    const distanceKm = haversineKm(start, candidatePoint.point);
    if (distanceKm < MIN_ROUTE_DISTANCE_KM || distanceKm > MAX_GENERIC_DISTANCE_KM) {
      continue;
    }
    const key = routeBucketKey(start, candidatePoint.point);
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
    group.sort((left, right) => {
      const rightScore = homewardScore(start, right.point, homeCentre);
      const leftScore = homewardScore(start, left.point, homeCentre);
      const rightHomeward = rightScore >= -0.1 ? 0 : 1;
      const leftHomeward = leftScore >= -0.1 ? 0 : 1;
      return (
        leftHomeward - rightHomeward ||
        rightScore - leftScore ||
        left.distanceKm - right.distanceKm ||
        left.id.localeCompare(right.id)
      );
    });
  }

  const ordered: GenericJob[] = [];
  let appended = true;
  while (appended) {
    appended = false;
    for (let sector = 0; sector < 8; sector += 1) {
      for (let band = 0; band < 3; band += 1) {
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

function qualityGate(geometry: LatLng[]) {
  const coverage = measureRouteCoverage(geometry);
  return {
    coverage,
    // mixedTrafficMeters is derived from verifiedCoverage, so using both as hard gates
    // turns long routes into an implicit near-100%-coverage requirement.
    eligible: coverage.verifiedCoverage >= VERIFIED_COVERAGE_MINIMUM
  };
}

function buildGenericCandidate(
  job: GenericJob,
  route: RouteResponse,
  profile: RoutingProfile,
  requireOfficialCoverage = true
) {
  const routeEndpoint = route.geometry.at(-1) ?? job.point;
  const endpointAnchor = nearestEligibleAnchor(routeEndpoint);
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
    endpoint: routeEndpoint,
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

function addRoutingStats(total: RoutingAttemptStats, delta: RoutingAttemptStats) {
  total.attempted += delta.attempted;
  total.systemicFailures += delta.systemicFailures;
  total.noRouteOrQualityMisses += delta.noRouteOrQualityMisses;
}

async function runJob(job: GenericJob, start: LatLng, deps: DiscoveryDeps) {
  const routingProfiles = deps.routingProfiles ?? ROUTING_PROFILES;
  const stats: RoutingAttemptStats = {
    attempted: 0,
    systemicFailures: 0,
    noRouteOrQualityMisses: 0
  };
  for (const profile of routingProfiles) {
    stats.attempted += 1;
    let route: RouteResponse | null = null;
    try {
      route = await deps.fetchRoute({ start, end: job.point, profile });
    } catch {
      stats.systemicFailures += 1;
      continue;
    }
    if (
      !route ||
      route.distanceKm < MIN_ROUTE_DISTANCE_KM ||
      route.distanceKm > MAX_GENERIC_DISTANCE_KM
    ) {
      stats.noRouteOrQualityMisses += 1;
      continue;
    }
    const candidate = buildGenericCandidate(job, route, profile);
    if (candidate) {
      return { candidates: [candidate], stats };
    }
    stats.noRouteOrQualityMisses += 1;
  }
  return { candidates: [], stats };
}

async function backfillRouteVariety({
  genericJobs,
  pageJobs,
  routes,
  diagnostics,
  routingAttemptStats,
  start,
  deps
}: {
  genericJobs: GenericJob[];
  pageJobs: GenericJob[];
  routes: RouteCandidate[];
  diagnostics: CandidateEvaluation[];
  routingAttemptStats: RoutingAttemptStats;
  start: LatLng;
  deps: DiscoveryDeps;
}) {
  const targetBuckets = deps.minDiverseRouteBuckets ?? MIN_DIVERSE_ROUTE_BUCKETS;
  const routeBuckets = new Set(routes.map((route) => routeBucketKey(start, route.endpoint)));
  if (routes.length === 0 || routeBuckets.size >= targetBuckets) {
    return;
  }

  const attempted = new Set(pageJobs.map((job) => job.id));
  const remainingJobs = genericJobs
    .filter((job) => !attempted.has(job.id))
    .sort((left, right) => {
      const leftBucketCovered = routeBuckets.has(routeBucketKey(start, left.point)) ? 1 : 0;
      const rightBucketCovered = routeBuckets.has(routeBucketKey(start, right.point)) ? 1 : 0;
      return leftBucketCovered - rightBucketCovered;
    });

  const maxAttempts = deps.maxDiversityBackfillEndpoints ?? MAX_DIVERSITY_BACKFILL_ENDPOINTS;
  let attempts = 0;
  for (const job of remainingJobs) {
    if (attempts >= maxAttempts || routeBuckets.size >= targetBuckets) {
      break;
    }
    if (!nearestEligibleAnchor(job.point).eligible) {
      continue;
    }
    attempts += 1;

    const { candidates, stats } = await runJob(job, start, deps);
    addRoutingStats(routingAttemptStats, stats);
    const candidate = candidates.find((next) => !routes.some((route) => similarCandidate(route, next)));
    if (!candidate) {
      continue;
    }

    routes.push(candidate);
    routeBuckets.add(routeBucketKey(start, candidate.endpoint));
    diagnostics.push({
      candidateId: candidate.id,
      accepted: true,
      reason: "diversity_backfill"
    });
  }
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
  const eligibleJobs = eligibleGenericJobs(genericJobs);
  const pageJobs = eligibleJobs.slice(0, deps.maxDiscoveryEndpoints ?? MAX_DISCOVERY_ENDPOINTS);
  const networkVersion = getVerifiedNetwork().version;
  const routingAttemptStats: RoutingAttemptStats = {
    attempted: 0,
    systemicFailures: 0,
    noRouteOrQualityMisses: 0
  };

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
      graphVersion: networkVersion,
      routingAttemptStats
    };
  }

  const routes: RouteCandidate[] = [];
  const diagnostics: CandidateEvaluation[] = [];

  for (let index = 0; index < pageJobs.length; index += DISCOVERY_BATCH_SIZE) {
    const batch = pageJobs.slice(index, index + DISCOVERY_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (job) => {
        const { candidates, stats } = await runJob(job, request.start.point, deps);
        addRoutingStats(routingAttemptStats, stats);
        if (candidates.length === 0) {
          diagnostics.push({
            candidateId: job.id,
            accepted: false,
            reason:
              stats.systemicFailures > 0 && stats.systemicFailures >= stats.attempted
                ? "routing_systemic_failure"
                : "route_or_quality_gate"
          });
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

  await backfillRouteVariety({
    genericJobs,
    pageJobs,
    routes,
    diagnostics,
    routingAttemptStats,
    start: request.start.point,
    deps
  });

  if (routes.length === 0) {
    const attempted = new Set(pageJobs.map((job) => job.id));
    const maxFallbackAttempts = deps.maxFallbackEndpoints ?? MAX_DISCOVERY_ENDPOINTS;
    let fallbackAttempts = 0;

    for (const job of genericJobs) {
      if (fallbackAttempts >= maxFallbackAttempts) {
        break;
      }
      if (attempted.has(job.id) || !nearestEligibleAnchor(job.point).eligible) {
        continue;
      }
      fallbackAttempts += 1;
      const { candidates, stats } = await runJob(job, request.start.point, {
        ...deps,
        routingProfiles: ["bicycle"]
      });
      addRoutingStats(routingAttemptStats, stats);
      const fallback = candidates[0];
      if (!fallback) {
        continue;
      }
      routes.push(fallback);
      diagnostics.push({ candidateId: fallback.id, accepted: true, reason: "all_bicycle_fallback" });
      break;
    }
  }

  const liveDiscoveryStatus =
    routes.length === 0
      ? "unavailable"
      : diagnostics.some((diagnostic) => !diagnostic.accepted)
        ? "partial"
        : "available";

  return {
    routes: sortRoutesForDiscoveryPage(routes, request.start.point),
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
    graphVersion: networkVersion,
    routingAttemptStats
  };
}
