import { corridorSeeds } from "../data/corridors.js";
import { anchorSeeds } from "../data/anchors.js";
import { average, classifyFairness, majorityFriendlySpread, spread, standardDeviation } from "./fairness.js";
import { clamp, haversineKm, offsetPerpendicularKm, polylineDistanceKm } from "./geo.js";
import { estimateTransitMinutesBetween } from "./transit.js";
import type { CorridorSeed, PlannedRoutes, ResolvedParticipant, RoutePlan } from "../types.js";

type PlannerInput = {
  start: { label: string; point: { lat: number; lng: number } };
  participants: ResolvedParticipant[];
  startTimeIso: string;
  transitOverrides?: Record<string, number>;
};

function buildGeometry(
  start: { lat: number; lng: number },
  corridor: CorridorSeed,
  detour: CorridorSeed["detours"][number]
) {
  const points = [
    start,
    ...detour.controlPoints.map((control) =>
      offsetPerpendicularKm(start, corridor.endpoint, control.t, control.perpendicularKm)
    ),
    corridor.endpoint
  ];
  return points;
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

function getPreferredAnchorPoint(corridor: CorridorSeed) {
  return (
    anchorSeeds.find((anchor) => anchor.id === corridor.preferredAnchorId)?.point ??
    corridor.endpoint
  );
}

function routeTransitKey(routeId: string, participantId: string) {
  return `${routeId}::${participantId}`;
}

function scoreRoute(route: RoutePlan) {
  return (
    route.fairnessSpreadMinutes * 100 +
    route.fairnessStdDeviationMinutes * 10 -
    route.commonCorridorCoverage * 5 +
    route.averageJourneyHomeMinutes * 0.2
  );
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

export function buildTransitQueries({
  start,
  participants,
  startTimeIso
}: PlannerInput) {
  const queries: Array<{
    key: string;
    query: {
      from: { lat: number; lng: number };
      to: { lat: number; lng: number };
      departureIso: string;
      modeHint: "rail" | "bus";
    };
  }> = [];

  for (const corridor of corridorSeeds) {
    for (const detour of corridor.detours) {
      const routeId = `${corridor.id}-${detour.id}`;
      const geometry = buildGeometry(start.point, corridor, detour);
      const rawDistance = polylineDistanceKm(geometry) * detour.distanceMultiplier;
      const distanceKm = Math.round(rawDistance * 10) / 10;
      const cyclingMinutes = Math.round((distanceKm / 16) * 60);
      const transitDeparture = new Date(startTimeIso);
      transitDeparture.setMinutes(transitDeparture.getMinutes() + cyclingMinutes + 90);
      const departureIso = transitDeparture.toISOString();
      const preferredAnchor = getPreferredAnchorPoint(corridor);
      const endpointForTransit =
        haversineKm(preferredAnchor, corridor.endpoint) < 1
          ? corridor.endpoint
          : preferredAnchor;

      for (const participant of participants) {
        queries.push({
          key: routeTransitKey(routeId, participant.id),
          query: {
            from: endpointForTransit,
            to: participant.anchor.point,
            departureIso,
            modeHint: participant.anchor.kind
          }
        });
      }
    }
  }

  return queries;
}

function planCandidateRoutes({
  start,
  participants,
  startTimeIso,
  transitOverrides
}: PlannerInput) {
  const startPoint = start.point;

  return corridorSeeds
    .flatMap((corridor) =>
      corridor.detours.map((detour) => {
        const geometry = buildGeometry(startPoint, corridor, detour);
        const rawDistance = polylineDistanceKm(geometry) * detour.distanceMultiplier;
        const distanceKm = Math.round(rawDistance * 10) / 10;
        const cyclingMinutes = Math.round((distanceKm / 16) * 60);
        const transitDeparture = new Date(startTimeIso);
        transitDeparture.setMinutes(transitDeparture.getMinutes() + cyclingMinutes + 90);
        const departureIso = transitDeparture.toISOString();
        const preferredAnchor = getPreferredAnchorPoint(corridor);

        const participantTimes = participants.map((participant) => {
          const routeId = `${corridor.id}-${detour.id}`;
          const endpointForTransit =
            haversineKm(preferredAnchor, corridor.endpoint) < 1
              ? corridor.endpoint
              : preferredAnchor;
          const transitMinutes =
            transitOverrides?.[routeTransitKey(routeId, participant.id)] ??
            estimateTransitMinutesBetween(
              endpointForTransit,
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
        const fairnessSpreadMinutes = spread(times);
        const fairnessStdDeviationMinutes = Math.round(standardDeviation(times) * 10) / 10;
        const averageJourneyHomeMinutes = Math.round(average(times));
        const pcnCoverage = clamp(corridor.basePcnCoverage - detour.distanceMultiplier * 0.02, 0.45, 0.95);
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

        const route: RoutePlan = {
          id: `${corridor.id}-${detour.id}`,
          corridorId: corridor.id,
          corridorName: corridor.name,
          routeName: detour.name,
          endpointName: corridor.endpointName,
          endpoint: corridor.endpoint,
          geometry,
          distanceKm,
          cyclingMinutes,
          pcnCoverage,
          cyclingPathCoverage,
          commonCorridorCoverage,
          mixedTrafficMeters,
          averageJourneyHomeMinutes,
          fairnessSpreadMinutes,
          fairnessStdDeviationMinutes,
          fairnessTier: classifyFairness(fairnessSpreadMinutes),
          participantTimes,
          popularityEvidence: corridor.evidence,
          majorityFriendly: fairnessSpreadMinutes > 30 && majorityFriendlySpread(times),
          overlapSignature: routeSignature(geometry)
        };

        return route;
      })
    )
    .filter((route) => route.mixedTrafficMeters <= 250)
    .filter((route) => route.distanceKm >= 3);
}

function selectDiverseRoutes(candidates: RoutePlan[]) {
  const chosen: RoutePlan[] = [];
  const byScore = [...candidates].sort((a, b) => scoreRoute(a) - scoreRoute(b));
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
    if (chosen.length >= 8) {
      break;
    }
  }

  return chosen.sort((a, b) => a.distanceKm - b.distanceKm);
}

export function planRoutes(input: PlannerInput): PlannedRoutes {
  const candidates = planCandidateRoutes(input);
  const primaryPool = candidates.filter((route) => route.fairnessSpreadMinutes <= 30);
  const unevenPool = candidates.filter((route) => route.fairnessSpreadMinutes > 30);
  const primary = selectDiverseRoutes(primaryPool);

  const uneven =
    input.participants.length >= 4
      ? selectDiverseRoutes(unevenPool.filter((route) => route.majorityFriendly)).slice(0, 2)
      : [];

  return {
    primary,
    uneven,
    computedAt: new Date().toISOString()
  };
}
