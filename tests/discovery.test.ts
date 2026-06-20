import { describe, expect, it, vi } from "vitest";

vi.mock("../src/data/corridors.js", () => ({
  corridorSeeds: [
    {
      id: "test-corridor",
      name: "Test corridor",
      endpointName: "Test endpoint",
      endpoint: { lat: 1.31, lng: 103.88 },
      preferredAnchorId: "test-anchor",
      basePcnCoverage: 0.7,
      baseCyclingPathCoverage: 0.2,
      baseCommonCorridorCoverage: 0.8,
      baseMixedTrafficMeters: 120,
      evidence: [],
      detours: []
    }
  ]
}));

vi.mock("../src/data/anchors.js", () => ({
  anchorSeeds: [
    {
      id: "test-anchor",
      name: "Test MRT",
      kind: "rail",
      point: { lat: 1.31, lng: 103.88 }
    }
  ]
}));

describe("live discovery", () => {
  it("treats a fetched live spine as available even when no sampled waypoints survive", async () => {
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const result = await discoverCyclingRoutes(
      {
        start: {
          label: "Marina Bay",
          point: { lat: 1.2808, lng: 103.8545 }
        },
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
        fetchRoute: async () => ({
          geometry: [
            { lat: 1.2808, lng: 103.8545 },
            { lat: 1.29, lng: 103.86 },
            { lat: 1.3, lng: 103.87 },
            { lat: 1.31, lng: 103.88 }
          ],
          distanceKm: 4.2,
          durationMinutes: 18
        }),
        getNearbyTransport: async () => ({
          rails: [],
          buses: []
        })
      }
    );

    expect(result.curatedCandidates).toHaveLength(1);
    expect(result.zoneStatuses[0]?.status).toBe("available");
    expect(result.liveDiscoveryStatus).toBe("available");
  });
});
