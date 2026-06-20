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
      detours: [
        {
          id: "direct",
          name: "Direct",
          distanceMultiplier: 1,
          controlPoints: []
        }
      ]
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
  it("falls back to the local curated corridor when the live spine request throws", async () => {
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const getNearbyTransport = vi.fn(async () => ({
      rails: [],
      buses: []
    }));
    const fetchRoute = vi.fn(async () => {
      throw new Error("upstream failed");
    });
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
        fetchRoute,
        getNearbyTransport
      }
    );

    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(getNearbyTransport).not.toHaveBeenCalled();
    expect(result.curatedCandidates).toHaveLength(1);
    expect(result.zoneStatuses[0]?.status).toBe("available");
    expect(result.liveDiscoveryStatus).toBe("available");
  });
});
