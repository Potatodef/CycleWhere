import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/verifiedNetwork.js", () => ({
  listVerifiedCandidatePoints: () => [
    {
      id: "candidate-a",
      point: { lat: 1.32403889, lng: 103.93003611 },
      sourceKinds: ["cycling-path"],
      nearbyFeatureIds: ["cycling-path-1"]
    },
    {
      id: "candidate-b",
      point: { lat: 1.355, lng: 103.94388889 },
      sourceKinds: ["cycling-path"],
      nearbyFeatureIds: ["cycling-path-2"]
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
        { lat: 1.29, lng: 103.87 },
        { lat: 1.305, lng: 103.895 },
        { lat: 1.32403889, lng: 103.93003611 }
      ],
      distanceKm: 6.2,
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

    expect(fetchRoute).toHaveBeenCalledTimes(2);
    expect(result.routes).toHaveLength(2);
    expect(result.routes[0]?.verifiedCoverage).toBeGreaterThanOrEqual(0.55);
    expect(result.zoneStatuses[0]?.status).toBe("available");
    expect(result.liveDiscoveryStatus).toBe("available");
    expect(result.graphVersion).toBeTruthy();
  });

  it("marks discovery partial when only some candidates survive routing", async () => {
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const fetchRoute = vi.fn(async ({ end }: { end: { lat: number; lng: number } }) => {
      if (end.lat === 1.355) {
        return null;
      }

      return {
        geometry: [
          { lat: 1.2808, lng: 103.8545 },
          { lat: 1.29, lng: 103.87 },
          { lat: 1.305, lng: 103.895 },
          { lat: 1.32403889, lng: 103.93003611 }
        ],
        distanceKm: 6.2,
        durationMinutes: 18
      };
    });
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

    expect(result.routes).toHaveLength(1);
    expect(result.diagnostics.some((diagnostic) => !diagnostic.accepted)).toBe(true);
    expect(result.zoneStatuses[0]?.status).toBe("partial");
    expect(result.liveDiscoveryStatus).toBe("partial");
  });
});
