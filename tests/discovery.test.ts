import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/verifiedNetwork.js", () => ({
  listVerifiedCandidatePoints: () => [
    {
      id: "candidate-a",
      point: { lat: 1.31, lng: 103.88 },
      sourceKinds: ["cycling-path"],
      nearbyFeatureIds: ["cycling-path-1"]
    }
  ],
  listVerifiedBusAnchors: () => [],
  listVerifiedNamedRoutes: () => [],
  getVerifiedNetwork: () => ({ version: "2026-06-21" }),
  measureRouteCoverage: () => ({
    verifiedCoverage: 0.81,
    pcnCoverage: 0.34,
    cyclingPathCoverage: 0.46,
    mixedTrafficMeters: 180,
    sourceDatasets: ["d_8f468b25193f64be8a16fa7d8f60f553"],
    sourceFeatureIds: ["cycling-path-1"]
  })
}));

describe("live discovery", () => {
  it("returns verified network routes when the route and transport anchor are both valid", async () => {
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const fetchRoute = vi.fn(async () => ({
      geometry: [
        { lat: 1.2808, lng: 103.8545 },
        { lat: 1.29, lng: 103.86 },
        { lat: 1.3, lng: 103.87 },
        { lat: 1.31, lng: 103.88 }
      ],
      distanceKm: 4.2,
      durationMinutes: 18
    }));
    const result = await discoverCyclingRoutes(
      {
        start: {
          label: "Marina Bay",
          point: { lat: 1.2808, lng: 103.8545 }
        },
        departureIso: "2026-06-21T10:00:00.000Z",
        participants: [
          {
            id: "a",
            name: "A",
            station: { lat: 1.3249, lng: 103.9303 },
            anchor: {
              id: "a-anchor",
              name: "Bedok MRT",
              kind: "rail",
              point: { lat: 1.3249, lng: 103.9303 },
              distanceFromHomeKm: 0.1,
              fallbackSuggested: false
            }
          }
        ]
      },
      {
        fetchRoute
      }
    );

    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.verifiedCoverage).toBeGreaterThanOrEqual(0.55);
    expect(result.zoneStatuses[0]?.status).toBe("available");
    expect(result.liveDiscoveryStatus).toBe("available");
    expect(result.graphVersion).toBeTruthy();
  });
});
