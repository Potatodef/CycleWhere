import { describe, expect, it } from "vitest";
import { filterPlannedRoutes } from "../src/lib/routeFilters.js";
import type { PlannedRoutes, RoutePlan } from "../src/types.js";

function makeRoute(id: string, distanceKm: number, fairnessSpreadMinutes: number): RoutePlan {
  return {
    id,
    zoneId: "zone-a",
    zoneName: "Zone A",
    source: "curated",
    profile: "cycling",
    routeName: id,
    endpointName: `${id} end`,
    endpoint: { lat: 1.3, lng: 103.8 },
    endpointAnchor: {
      id: `${id}-anchor`,
      name: `${id} Anchor`,
      kind: "rail",
      point: { lat: 1.3, lng: 103.8 },
      distanceFromHomeKm: 0,
      fallbackSuggested: false
    },
    geometry: [],
    distanceKm,
    cyclingMinutes: 30,
    routeQualitySource: "measured",
    overlapSignature: [],
    averageJourneyHomeMinutes: 20,
    fairnessSpreadMinutes,
    fairnessStdDeviationMinutes: 4,
    fairnessTier: "Excellent",
    participantTimes: [],
    majorityFriendly: true,
    confidence: "validated",
    section: "trusted-matches"
  };
}

const plannedRoutes: PlannedRoutes = {
  sections: [
    {
      id: "trusted-matches",
      title: "Trusted",
      bestFairnessRouteId: "short-fair",
      routes: [makeRoute("short-fair", 6, 12), makeRoute("long-fair", 14, 18)]
    }
  ],
  zoneStatuses: [],
  liveDiscoveryStatus: "available",
  computedAt: "2026-06-21T00:00:00.000Z"
};

describe("filterPlannedRoutes", () => {
  it("keeps only routes matching both distance and fairness filters", () => {
    const filtered = filterPlannedRoutes(plannedRoutes, {
      minimumDistanceKm: 10,
      maximumFairnessSpreadMinutes: 20
    });

    expect(filtered.sections).toHaveLength(1);
    expect(filtered.sections[0]?.routes.map((route) => route.id)).toEqual(["long-fair"]);
    expect(filtered.sections[0]?.bestFairnessRouteId).toBe("long-fair");
  });
});
