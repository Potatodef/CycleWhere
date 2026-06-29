import { describe, expect, it } from "vitest";
import { filterPlannedRoutes } from "../src/lib/routeFilters.js";
import type { PlannedRoutes, RoutePlan } from "../src/types.js";

function makeRoute(id: string, distanceKm: number, fairnessSpreadMinutes: number): RoutePlan {
  return {
    id,
    source: "verified-network",
    origin: "network-endpoint",
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
    sourceDatasets: ["d_8f468b25193f64be8a16fa7d8f60f553"],
    sourceFeatureIds: ["cycling-path-1"],
    distanceKm,
    cyclingMinutes: 30,
    routeQualitySource: "measured",
    overlapSignature: [],
    cyclingMinutesSource: "onemap",
    averageJourneyHomeMinutes: 20,
    fairnessSpreadMinutes,
    fairnessStdDeviationMinutes: 4,
    fairnessTier: "Excellent",
    participantTimes: [],
    majorityFriendly: true,
    confidence: "validated",
    fairnessSource: "exact",
    section: "best-fair-routes"
  };
}

const plannedRoutes: PlannedRoutes = {
  sections: [
    {
      id: "best-fair-routes",
      title: "Best fair routes",
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

  it("clears route sections when filters remove every route", () => {
    const filtered = filterPlannedRoutes(plannedRoutes, {
      minimumDistanceKm: 20,
      maximumFairnessSpreadMinutes: 10
    });

    expect(filtered.sections).toEqual([]);
    expect(filtered.zoneStatuses).toBe(plannedRoutes.zoneStatuses);
    expect(filtered.liveDiscoveryStatus).toBe("available");
  });

  it("keeps surviving sections and recalculates their best route id", () => {
    const multiSectionRoutes: PlannedRoutes = {
      ...plannedRoutes,
      sections: [
        plannedRoutes.sections[0]!,
        {
          id: "more-route-options",
          title: "More route options",
          bestFairnessRouteId: "short-backup",
          routes: [makeRoute("short-backup", 4, 8), makeRoute("long-backup", 16, 22)]
        }
      ]
    };

    const filtered = filterPlannedRoutes(multiSectionRoutes, {
      minimumDistanceKm: 10,
      maximumFairnessSpreadMinutes: 0
    });

    expect(filtered.sections.map((section) => section.id)).toEqual([
      "best-fair-routes",
      "more-route-options"
    ]);
    expect(filtered.sections[0]?.routes.map((route) => route.id)).toEqual(["long-fair"]);
    expect(filtered.sections[0]?.bestFairnessRouteId).toBe("long-fair");
    expect(filtered.sections[1]?.routes.map((route) => route.id)).toEqual(["long-backup"]);
    expect(filtered.sections[1]?.bestFairnessRouteId).toBe("long-backup");
  });
});
