import { corridorSeeds } from "../data/corridors.js";
import { anchorSeeds } from "../data/anchors.js";
import {
  average,
  classifyFairness,
  majorityFriendlySpread,
  spread,
  standardDeviation
} from "./fairness.js";
import { clamp, haversineKm, offsetPerpendicularKm, polylineDistanceKm } from "./geo.js";
import { estimateTransitMinutesBetween } from "./transit.js";
import type {
  LiveDiscoveryStatus,
  PlannedRoutes,
  ResolvedParticipant,
  RouteCandidate,
  RouteConfidence,
  RoutePlan,
  RouteSection,
  RouteSectionId,
  ZoneDiscoveryStatus
} from "../types.js";

type PlannerInput = {
  candidates: RouteCandidate[];
  participants: ResolvedParticipant[];
  startTimeIso: string;
  transitOverrides?: Record<string, number>;
  zoneStatuses?: ZoneDiscoveryStatus[];
  liveDiscoveryStatus?: LiveDiscoveryStatus;
};

type TransitQueryBundle = Array<{
  key: string;
  query: {
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
    departureIso: string;
    modeHint: "rail" | "bus";
  };
}>;

function buildGeometry(
  start: { lat: number; lng: number },
  corridor: (typeof corridorSeeds)[number],
  detour: (typeof corridorSeeds)[number]["detours"][number]
) {
  return [
    start,
    ...detour.controlPoints.map((control) =>
      offsetPerpendicularKm(start, corridor.endpoint, control.t, control.perpendicularKm)
    ),
    corridor.endpoint
  ];
}

function routeSignature(points: Array<{ lat: number; lng: number }>) {
  const signature: string[] = [];
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

function overlapRatio(a: string[], b: string[]) {
  const aSet = new Set(a);
  const bSet = new Set(b);
  const intersection = [...aSet].filter((value) => bSet.has(value)).length;
  const union = new Set([...aSet, ...bSet]).size || 1;
  return intersection / union;
}

function getPreferredAnchor(corridorId: string) {
  const corridor = corridorSeeds.find((seed) => seed.id === corridorId);
  if (!corridor) {
    return null;
  }

  return anchorSeeds.find((anchor) => anchor.id === corridor.preferredAnchorId) ?? null;
}

function routeTransitKey(routeId: string, participantId: string) {
  return `${routeId}::${participantId}`;
}

function distanceBand(value: number) {
  if (value < 10) {
    return "short";
  }
  if (value < 20) {
    return "mid";
  }
  if (value < 35) {
    return "long";
  }
  return "epic";
}

function confidenceRank(confidence: RouteConfidence) {
  switch (confidence) {
    case "validated":
      return 3;
    case "aligned":
      return 2;
    case "novel":
      return 1;
    default:
      return 0;
  }
}

function compareRoutes(a: RoutePlan, b: RoutePlan) {
  if (a.fairnessSpreadMinutes !== b.fairnessSpreadMinutes) {
    return a.fairnessSpreadMinutes - b.fairnessSpreadMinutes;
  }
  if (a.fairnessStdDeviationMinutes !== b.fairnessStdDeviationMinutes) {
    return a.fairnessStdDeviationMinutes - b.fairnessStdDeviationMinutes;
  }
  if (a.averageJourneyHomeMinutes !== b.averageJourneyHomeMinutes) {
    return a.averageJourneyHomeMinutes - b.averageJourneyHomeMinutes;
  }

  if (
    a.routeQualityScore !== null &&
    a.routeQualityScore !== undefined &&
    b.routeQualityScore !== null &&
    b.routeQualityScore !== undefined &&
    a.routeQualityScore !== b.routeQualityScore
  ) {
    return b.routeQualityScore - a.routeQualityScore;
  }

  const confidenceDelta = confidenceRank(b.confidence) - confidenceRank(a.confidence);
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }

  return a.distanceKm - b.distanceKm;
}

function selectDiverseRoutes(candidates: RoutePlan[]) {
  const chosen: RoutePlan[] = [];
  const byScore = [...candidates].sort(compareRoutes);
  const bandCounts = new Map<string, number>();

  for (const candidate of byScore) {
    const band = distanceBand(candidate.distanceKm);
    const usedInBand = bandCounts.get(band) ?? 0;
    if (usedInBand >= 2) {
      continue;
    }

    const tooSimilar = chosen.some((existing) => {
      const overlap = overlapRatio(existing.overlapSignature, candidate.overlapSignature);
      const distanceDelta = Math.abs(existing.distanceKm - candidate.distanceKm) / existing.distanceKm;
      return overlap >= 0.75 && distanceDelta < 0.2;
    });

    if (tooSimilar) {
      continue;
    }

    chosen.push(candidate);
    bandCounts.set(band, usedInBand + 1);
  }

  return chosen;
}

function routeQualityScore(candidate: RouteCandidate) {
  if (
    candidate.pcnCoverage === undefined ||
    candidate.commonCorridorCoverage === undefined ||
    candidate.mixedTrafficMeters === undefined
  ) {
    return candidate.routeQualityScore ?? null;
  }

  return Math.round(
    candidate.pcnCoverage * 45 +
      (candidate.cyclingPathCoverage ?? 0) * 20 +
      candidate.commonCorridorCoverage * 30 -
      candidate.mixedTrafficMeters / 25
  );
}

function transitOriginPoint(candidate: RouteCandidate) {
  return haversineKm(candidate.endpointAnchor.point, candidate.endpoint) < 1
    ? candidate.endpoint
    : candidate.endpointAnchor.point;
}

function toFairnessSection(route: RoutePlan): RouteSectionId {
  if (route.fairnessSpreadMinutes > 30 && route.majorityFriendly) {
    return "majority-friendly-uneven";
  }
  if (route.source === "discovered" && confidenceRank(route.confidence) >= 2) {
    return "trusted-matches";
  }
  if (route.source === "discovered") {
    return "best-discovered";
  }
  return "curated-alternatives";
}

function buildSection(id: RouteSectionId, title: string, routes: RoutePlan[]): RouteSection {
  const ordered = [...routes].sort((a, b) => a.distanceKm - b.distanceKm);
  const best = [...routes].sort(compareRoutes)[0];
  return {
    id,
    title,
    routes: ordered,
    bestFairnessRouteId: best?.id
  };
}

export function generateCuratedCandidates(start: { label: string; point: { lat: number; lng: number } }) {
  return corridorSeeds
    .flatMap((corridor) =>
      corridor.detours.map((detour) => {
        const geometry = buildGeometry(start.point, corridor, detour);
        const rawDistance = polylineDistanceKm(geometry) * detour.distanceMultiplier;
        const distanceKm = Math.round(rawDistance * 10) / 10;
        const cyclingMinutes = Math.round((distanceKm / 16) * 60);
        const pcnCoverage = clamp(
          corridor.basePcnCoverage - detour.distanceMultiplier * 0.02,
          0.45,
          0.95
        );
        const cyclingPathCoverage = clamp(
          corridor.baseCyclingPathCoverage + (detour.distanceMultiplier - 1) * 0.08,
          0.04,
          0.34
        );
        const commonCorridorCoverage = clamp(
          corridor.baseCommonCorridorCoverage + (detour.distanceMultiplier - 1) * 0.12,
          0.3,
          0.92
        );
        const mixedTrafficMeters = Math.round(
          corridor.baseMixedTrafficMeters + Math.max(0, distanceKm - 15) * 4
        );
        const preferredAnchor = getPreferredAnchor(corridor.id);

        if (!preferredAnchor) {
          return null;
        }

        const candidate: RouteCandidate = {
          id: `${corridor.id}-${detour.id}`,
          zoneId: corridor.id,
          zoneName: corridor.name,
          source: "curated",
          profile: "cycling",
          corridorId: corridor.id,
          corridorName: corridor.name,
          routeName: detour.name,
          endpointName: corridor.endpointName,
          endpoint: corridor.endpoint,
          endpointAnchor: {
            id: preferredAnchor.id,
            name: preferredAnchor.name,
            kind: preferredAnchor.kind,
            point: preferredAnchor.point,
            distanceFromHomeKm: haversineKm(preferredAnchor.point, corridor.endpoint),
            fallbackSuggested: false
          },
          geometry,
          distanceKm,
          cyclingMinutes,
          pcnCoverage,
          cyclingPathCoverage,
          commonCorridorCoverage,
          mixedTrafficMeters,
          popularityEvidence: corridor.evidence,
          routeQualityScore: null,
          routeQualitySource: "measured",
          overlapSignature: routeSignature(geometry)
        };

        candidate.routeQualityScore = routeQualityScore(candidate);
        return candidate;
      })
    )
    .filter((candidate): candidate is RouteCandidate => Boolean(candidate))
    .filter((candidate) => (candidate.mixedTrafficMeters ?? 0) <= 250)
    .filter((candidate) => candidate.distanceKm >= 3);
}

export function buildTransitQueries({
  candidates,
  participants,
  startTimeIso
}: {
  candidates: RouteCandidate[];
  participants: ResolvedParticipant[];
  startTimeIso: string;
}): TransitQueryBundle {
  const queries: TransitQueryBundle = [];

  for (const candidate of candidates) {
    const transitDeparture = new Date(startTimeIso);
    transitDeparture.setMinutes(transitDeparture.getMinutes() + candidate.cyclingMinutes + 90);
    const departureIso = transitDeparture.toISOString();
    const transitFrom = transitOriginPoint(candidate);

    for (const participant of participants) {
      queries.push({
        key: routeTransitKey(candidate.id, participant.id),
        query: {
          from: transitFrom,
          to: participant.anchor.point,
          departureIso,
          modeHint: participant.anchor.kind
        }
      });
    }
  }

  return queries;
}

function scoreCandidates({
  candidates,
  participants,
  startTimeIso,
  transitOverrides
}: PlannerInput) {
  return candidates.map((candidate) => {
    const transitDeparture = new Date(startTimeIso);
    transitDeparture.setMinutes(transitDeparture.getMinutes() + candidate.cyclingMinutes + 90);
    const departureIso = transitDeparture.toISOString();
    const transitFrom = transitOriginPoint(candidate);

    const participantTimes = participants.map((participant) => {
      const transitMinutes =
        transitOverrides?.[routeTransitKey(candidate.id, participant.id)] ??
        estimateTransitMinutesBetween(
          transitFrom,
          participant.anchor.point,
          departureIso,
          participant.anchor.kind
        );

      return {
        participantId: participant.id,
        participantName: participant.name,
        anchorName: participant.anchor.name,
        transitMinutes
      };
    });

    const times = participantTimes.map((participant) => participant.transitMinutes);

    return {
      ...candidate,
      routeQualityScore: routeQualityScore(candidate),
      averageJourneyHomeMinutes: Math.round(average(times)),
      fairnessSpreadMinutes: spread(times),
      fairnessStdDeviationMinutes: Math.round(standardDeviation(times) * 10) / 10,
      fairnessTier: classifyFairness(spread(times)),
      participantTimes,
      majorityFriendly: spread(times) > 30 && majorityFriendlySpread(times),
      confidence: "heuristic-only" as const,
      section: "curated-alternatives" as const
    } satisfies RoutePlan;
  });
}

function applyAgreementAndMerge(
  routes: RoutePlan[],
  zoneStatuses: ZoneDiscoveryStatus[]
) {
  const suppressed = new Set<string>();
  const discovered = routes.filter((route) => route.source === "discovered");
  const curated = routes.filter((route) => route.source === "curated");
  const merged: RoutePlan[] = [];

  for (const route of discovered) {
    const potentialMatches = curated.filter((candidate) => candidate.zoneId === route.zoneId);
    let bestMatch: RoutePlan | null = null;
    let bestOverlap = 0;

    for (const candidate of potentialMatches) {
      const overlap = overlapRatio(route.overlapSignature, candidate.overlapSignature);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = candidate;
      }
    }

    let confidence: RouteConfidence = "novel";
    if (bestOverlap >= 0.5) {
      confidence = "validated";
    } else if (bestOverlap >= 0.25) {
      confidence = "aligned";
    }

    const candidate = {
      ...route,
      confidence,
      matchedCorridorId: bestMatch?.corridorId,
      corridorAgreementScore: Math.round(bestOverlap * 100) / 100
    };

    if (bestMatch) {
      const distanceDelta = Math.abs(bestMatch.distanceKm - route.distanceKm) / bestMatch.distanceKm;
      if (bestOverlap >= 0.75 && distanceDelta < 0.2) {
        suppressed.add(bestMatch.id);
        merged.push({
          ...candidate,
          corridorId: bestMatch.corridorId,
          corridorName: bestMatch.corridorName,
          pcnCoverage: bestMatch.pcnCoverage,
          cyclingPathCoverage: bestMatch.cyclingPathCoverage,
          commonCorridorCoverage: bestMatch.commonCorridorCoverage,
          mixedTrafficMeters: bestMatch.mixedTrafficMeters,
          popularityEvidence: bestMatch.popularityEvidence,
          routeQualityScore: bestMatch.routeQualityScore ?? candidate.routeQualityScore,
          routeQualitySource: bestMatch.routeQualitySource
        });
        continue;
      }
    }

    merged.push(candidate);
  }

  for (const route of curated) {
    if (suppressed.has(route.id)) {
      continue;
    }

    merged.push({
      ...route,
      confidence: "heuristic-only"
    });
  }

  return merged.map((route) => ({
    ...route,
    section: toFairnessSection(route)
  }));
}

export function planRoutes(input: PlannerInput): PlannedRoutes {
  const zoneStatuses = input.zoneStatuses ?? [];
  const liveDiscoveryStatus = input.liveDiscoveryStatus ?? "unavailable";
  const candidates = scoreCandidates(input);
  const merged = applyAgreementAndMerge(candidates, zoneStatuses);

  const trustedMatches = selectDiverseRoutes(
    merged.filter((route) => route.section === "trusted-matches" && route.fairnessSpreadMinutes <= 30)
  );
  const bestDiscovered = selectDiverseRoutes(
    merged.filter((route) => route.section === "best-discovered" && route.fairnessSpreadMinutes <= 30)
  );
  const curatedAlternatives = selectDiverseRoutes(
    merged.filter((route) => route.section === "curated-alternatives" && route.fairnessSpreadMinutes <= 30)
  );
  const uneven = input.participants.length >= 4
    ? selectDiverseRoutes(
        merged.filter(
          (route) => route.section === "majority-friendly-uneven" && route.majorityFriendly
        )
      ).slice(0, 2)
    : [];

  const sections = [
    buildSection("trusted-matches", "Trusted corridor matches", trustedMatches),
    buildSection("best-discovered", "Best discovered routes", bestDiscovered),
    buildSection("curated-alternatives", "Curated alternatives", curatedAlternatives),
    buildSection("majority-friendly-uneven", "Majority-friendly uneven", uneven)
  ].filter((section) => section.routes.length > 0);

  return {
    sections,
    zoneStatuses,
    liveDiscoveryStatus,
    computedAt: new Date().toISOString()
  };
}
