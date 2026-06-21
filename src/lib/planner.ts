import {
  average,
  classifyFairness,
  majorityFriendlySpread,
  spread,
  standardDeviation
} from "./fairness.js";
import { haversineKm } from "./geo.js";
import { estimateTransitMinutesBetween } from "./transit.js";
import type {
  LiveDiscoveryStatus,
  PlannedRoutes,
  ResolvedParticipant,
  RouteCandidate,
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
  if (value < 60) {
    return "epic";
  }
  return "ultra";
}

function confidenceRank(coverage = 0) {
  if (coverage >= 0.8) {
    return 2;
  }
  if (coverage >= 0.65) {
    return 1;
  }
  return 0;
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
  if (a.fairnessSource !== b.fairnessSource) {
    return a.fairnessSource === "exact" ? -1 : 1;
  }
  if ((a.verifiedCoverage ?? 0) !== (b.verifiedCoverage ?? 0)) {
    return (b.verifiedCoverage ?? 0) - (a.verifiedCoverage ?? 0);
  }

  const aProtected = (a.pcnCoverage ?? 0) + (a.cyclingPathCoverage ?? 0);
  const bProtected = (b.pcnCoverage ?? 0) + (b.cyclingPathCoverage ?? 0);
  if (aProtected !== bProtected) {
    return bProtected - aProtected;
  }

  const confidenceDelta = confidenceRank(b.verifiedCoverage) - confidenceRank(a.verifiedCoverage);
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

    const tooSimilar = chosen.some((existing) => similarRoute(existing, candidate));

    if (tooSimilar) {
      continue;
    }

    chosen.push(candidate);
    bandCounts.set(band, usedInBand + 1);
  }

  return chosen;
}

function similarRoute(a: RoutePlan, b: RoutePlan) {
  const overlap = overlapRatio(a.overlapSignature, b.overlapSignature);
  const baseDistance = Math.max(a.distanceKm, 1);
  const distanceDelta = Math.abs(a.distanceKm - b.distanceKm) / baseDistance;
  return overlap >= 0.75 && distanceDelta < 0.2;
}

function routeQualityScore(candidate: RouteCandidate) {
  const verifiedCoverage = candidate.verifiedCoverage ?? 0;
  const protectedCoverage = (candidate.pcnCoverage ?? 0) + (candidate.cyclingPathCoverage ?? 0);
  const mixedTrafficPenalty = (candidate.mixedTrafficMeters ?? 0) / 80;
  return Math.round(verifiedCoverage * 70 + protectedCoverage * 20 - mixedTrafficPenalty);
}

function transitOriginPoint(candidate: RouteCandidate) {
  return haversineKm(candidate.endpointAnchor.point, candidate.endpoint) < 1
    ? candidate.endpoint
    : candidate.endpointAnchor.point;
}

function toFairnessSection(route: RoutePlan): RouteSectionId {
  if (route.fairnessSource !== "exact") {
    return "more-route-options";
  }
  if (route.fairnessSpreadMinutes > 30 && route.majorityFriendly) {
    return "majority-friendly-uneven";
  }
  return route.fairnessSpreadMinutes <= 20 ? "best-fair-routes" : "more-route-options";
}

function buildSection(id: RouteSectionId, title: string, routes: RoutePlan[]): RouteSection {
  const ordered = [...routes].sort(compareRoutes);
  return {
    id,
    title,
    routes: ordered,
    bestFairnessRouteId: ordered[0]?.id
  };
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
      const transitKey = routeTransitKey(candidate.id, participant.id);
      const transitMinutes =
        transitOverrides?.[transitKey] ??
        estimateTransitMinutesBetween(
          transitFrom,
          participant.anchor.point,
          departureIso,
          participant.anchor.kind
        );

      return {
        participantId: participant.id,
        participantName: participant.name,
        stationName: participant.anchor.name,
        transitMinutes
      };
    });

    const times = participantTimes.map((participant) => participant.transitMinutes);
    const verifiedCoverage = candidate.verifiedCoverage ?? 0;
    const fairnessSource = participants.every(
      (participant) => transitOverrides?.[routeTransitKey(candidate.id, participant.id)] !== undefined
    )
      ? "exact"
      : "estimated";

    return {
      ...candidate,
      overlapSignature: candidate.overlapSignature.length
        ? candidate.overlapSignature
        : routeSignature(candidate.geometry),
      routeQualityScore: routeQualityScore(candidate),
      averageJourneyHomeMinutes: Math.round(average(times)),
      fairnessSpreadMinutes: spread(times),
      fairnessStdDeviationMinutes: Math.round(standardDeviation(times) * 10) / 10,
      fairnessTier: classifyFairness(spread(times)),
      participantTimes,
      majorityFriendly: spread(times) > 30 && majorityFriendlySpread(times),
      confidence: verifiedCoverage >= 0.75 ? "validated" : verifiedCoverage >= 0.65 ? "aligned" : "heuristic-only",
      fairnessSource,
      section: "more-route-options" as const
    } satisfies RoutePlan;
  });
}

export function planRoutes(input: PlannerInput): PlannedRoutes {
  const zoneStatuses = input.zoneStatuses ?? [];
  const liveDiscoveryStatus = input.liveDiscoveryStatus ?? "unavailable";
  const scored = scoreCandidates(input).map((route) => ({
    ...route,
    section: toFairnessSection(route)
  }));

  const validRoutes = scored.filter((route) => route.fairnessSpreadMinutes <= 30);
  const bestFairRoutes = selectDiverseRoutes(
    validRoutes.filter((route) => route.section === "best-fair-routes")
  );
  const usedBestFair = new Set(bestFairRoutes.map((route) => route.id));
  const moreRouteOptions = selectDiverseRoutes(
    validRoutes
      .filter((route) => route.section === "more-route-options")
      .concat(
        validRoutes.filter((route) => route.section === "best-fair-routes" && !usedBestFair.has(route.id))
      )
      .filter((route) => !bestFairRoutes.some((selected) => similarRoute(selected, route)))
  );
  const uneven =
    input.participants.length >= 4
      ? selectDiverseRoutes(
          scored.filter(
            (route) => route.section === "majority-friendly-uneven" && route.majorityFriendly
          )
        ).slice(0, 2)
      : [];

  const sections = [
    buildSection("best-fair-routes", "Best fair routes", bestFairRoutes),
    buildSection("more-route-options", "More route options", moreRouteOptions),
    buildSection("majority-friendly-uneven", "Uneven but usable", uneven)
  ].filter((section) => section.routes.length > 0);

  return {
    sections,
    zoneStatuses,
    liveDiscoveryStatus,
    computedAt: new Date().toISOString()
  };
}
