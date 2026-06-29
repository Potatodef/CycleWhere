import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  coverage: {
    value: {
      verifiedCoverage: 0.81,
      pcnCoverage: 0.34,
      cyclingPathCoverage: 0.46,
      mixedTrafficMeters: 180,
      sourceDatasets: ["d_8f468b25193f64be8a16fa7d8f60f553"],
      sourceFeatureIds: ["cycling-path-1"]
    }
  },
  candidatePoints: [
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
  ]
}));

vi.mock("../src/lib/verifiedNetwork.js", () => ({
  listVerifiedCandidatePoints: () => mockState.candidatePoints,
  listVerifiedBusAnchors: () => [],
  listVerifiedNamedRoutes: () => [],
  getVerifiedNetwork: () => ({ version: "2026-06-21" }),
  measureRouteCoverage: () => mockState.coverage.value
}));

beforeEach(() => {
  mockState.coverage.value = {
    verifiedCoverage: 0.81,
    pcnCoverage: 0.34,
    cyclingPathCoverage: 0.46,
    mixedTrafficMeters: 180,
    sourceDatasets: ["d_8f468b25193f64be8a16fa7d8f60f553"],
    sourceFeatureIds: ["cycling-path-1"]
  };
  mockState.candidatePoints = [
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
  ];
});

describe("live discovery", () => {
  it("returns verified network routes when the route and transport anchor are both valid", async () => {
    mockState.coverage.value = {
      verifiedCoverage: 0.81,
      pcnCoverage: 0.34,
      cyclingPathCoverage: 0.46,
      mixedTrafficMeters: 180,
      sourceDatasets: ["d_8f468b25193f64be8a16fa7d8f60f553"],
      sourceFeatureIds: ["cycling-path-1"]
    };
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

  it("uses the routed geometry endpoint for candidate metadata", async () => {
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const routedEndpoint = { lat: 1.355, lng: 103.94388889 };
    const fetchRoute = vi.fn(async () => ({
      geometry: [
        { lat: 1.2808, lng: 103.8545 },
        { lat: 1.31, lng: 103.9 },
        routedEndpoint
      ],
      distanceKm: 8,
      durationMinutes: 24
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
        maxDiscoveryEndpoints: 1,
        fetchRoute
      }
    );

    expect(result.routes[0]?.endpoint).toEqual(routedEndpoint);
    expect(result.routes[0]?.endpointName).toBe("Tampines MRT");
  });

  it("keeps longer routes when verified coverage is strong even if mixed traffic meters are high", async () => {
    mockState.coverage.value = {
      verifiedCoverage: 0.68,
      pcnCoverage: 0.52,
      cyclingPathCoverage: 0.12,
      mixedTrafficMeters: 3200,
      sourceDatasets: ["d_8f468b25193f64be8a16fa7d8f60f553"],
      sourceFeatureIds: ["cycling-path-1"]
    };
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const fetchRoute = vi.fn(async () => ({
      geometry: [
        { lat: 1.2808, lng: 103.8545 },
        { lat: 1.29, lng: 103.87 },
        { lat: 1.305, lng: 103.895 },
        { lat: 1.32403889, lng: 103.93003611 }
      ],
      distanceKm: 18.4,
      durationMinutes: 56
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
        maxDiscoveryEndpoints: 1,
        maxDiversityBackfillEndpoints: 0,
        fetchRoute
      }
    );

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.verifiedCoverage).toBe(0.68);
  });

  it("does not spend the primary endpoint cap on points without a transport anchor", async () => {
    mockState.candidatePoints = [
      {
        id: "unanchored-north",
        point: { lat: 1.37, lng: 103.86 },
        sourceKinds: ["cycling-path"],
        nearbyFeatureIds: ["cycling-path-unanchored"]
      },
      {
        id: "bedok",
        point: { lat: 1.32403889, lng: 103.93003611 },
        sourceKinds: ["cycling-path"],
        nearbyFeatureIds: ["cycling-path-1"]
      }
    ];
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const fetchRoute = vi.fn(async ({ end }: { end: { lat: number; lng: number } }) => ({
      geometry: [
        { lat: 1.2808, lng: 103.8545 },
        { lat: (1.2808 + end.lat) / 2, lng: (103.8545 + end.lng) / 2 },
        end
      ],
      distanceKm: 8,
      durationMinutes: 24
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
        maxDiscoveryEndpoints: 1,
        maxDiversityBackfillEndpoints: 0,
        maxFallbackEndpoints: 0,
        routingProfiles: ["bicycle"],
        fetchRoute
      }
    );

    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(fetchRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        end: { lat: 1.32403889, lng: 103.93003611 }
      })
    );
    expect(result.routes.map((route) => route.id)).toEqual(["bedok"]);
    expect(result.liveDiscoveryStatus).toBe("available");
  });

  it("backfills extra eligible endpoint buckets when primary discovery is too narrow", async () => {
    mockState.coverage.value = {
      verifiedCoverage: 0.82,
      pcnCoverage: 0.34,
      cyclingPathCoverage: 0.46,
      mixedTrafficMeters: 180,
      sourceDatasets: ["d_8f468b25193f64be8a16fa7d8f60f553"],
      sourceFeatureIds: ["cycling-path-1"]
    };
    mockState.candidatePoints = [
      {
        id: "bedok",
        point: { lat: 1.32403889, lng: 103.93003611 },
        sourceKinds: ["cycling-path"],
        nearbyFeatureIds: ["cycling-path-1"]
      },
      {
        id: "eunos",
        point: { lat: 1.3197, lng: 103.9031 },
        sourceKinds: ["cycling-path"],
        nearbyFeatureIds: ["cycling-path-2"]
      },
      {
        id: "queenstown",
        point: { lat: 1.29444167, lng: 103.80611389 },
        sourceKinds: ["cycling-path"],
        nearbyFeatureIds: ["cycling-path-3"]
      },
      {
        id: "bishan",
        point: { lat: 1.35111111, lng: 103.84833333 },
        sourceKinds: ["cycling-path"],
        nearbyFeatureIds: ["cycling-path-4"]
      }
    ];
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const fetchRoute = vi.fn(async ({ end }: { end: { lat: number; lng: number } }) => ({
      geometry: [
        { lat: 1.2808, lng: 103.8545 },
        { lat: (1.2808 + end.lat) / 2, lng: (103.8545 + end.lng) / 2 },
        end
      ],
      distanceKm: 8,
      durationMinutes: 24
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
        maxDiscoveryEndpoints: 1,
        maxDiversityBackfillEndpoints: 2,
        minDiverseRouteBuckets: 3,
        routingProfiles: ["bicycle"],
        fetchRoute
      }
    );

    expect(fetchRoute).toHaveBeenCalledTimes(3);
    expect(result.routes).toHaveLength(3);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.reason === "diversity_backfill")).toHaveLength(2);
  });

  it("caps fallback routing attempts when first-page candidates fail", async () => {
    const { discoverCyclingRoutes } = await import("../worker/discovery.js");
    const fetchRoute = vi.fn(async () => null);

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
        maxDiscoveryEndpoints: 1,
        maxFallbackEndpoints: 0,
        routingProfiles: ["bicycle"],
        fetchRoute
      }
    );

    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(result.routes).toHaveLength(0);
    expect(result.liveDiscoveryStatus).toBe("unavailable");
  });
});
