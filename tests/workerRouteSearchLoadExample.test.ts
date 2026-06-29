import { describe, expect, it, vi } from "vitest";
import type { LatLng, RouteCandidate } from "../src/types.js";

vi.mock("../src/lib/verifiedNetwork.js", () => ({
  listVerifiedCandidatePoints: () => [
    {
      id: "bedok",
      point: { lat: 1.32403889, lng: 103.93003611 },
      sourceKinds: ["cycling-path"],
      nearbyFeatureIds: ["cycling-path-1"]
    },
    {
      id: "tampines",
      point: { lat: 1.355, lng: 103.94388889 },
      sourceKinds: ["cycling-path"],
      nearbyFeatureIds: ["cycling-path-2"]
    },
    {
      id: "paya-lebar",
      point: { lat: 1.31777778, lng: 103.8925 },
      sourceKinds: ["cycling-path"],
      nearbyFeatureIds: ["cycling-path-3"]
    },
    {
      id: "punggol",
      point: { lat: 1.40527778, lng: 103.9025 },
      sourceKinds: ["cycling-path"],
      nearbyFeatureIds: ["cycling-path-4"]
    }
  ],
  listVerifiedBusAnchors: () => [],
  listVerifiedNamedRoutes: () => [],
  getVerifiedNetwork: () => ({ version: "test" }),
  measureRouteCoverage: () => ({
    verifiedCoverage: 0.82,
    pcnCoverage: 0.34,
    cyclingPathCoverage: 0.46,
    mixedTrafficMeters: 180,
    sourceDatasets: ["d_8f468b25193f64be8a16fa7d8f60f553"],
    sourceFeatureIds: ["cycling-path-1"]
  })
}));

vi.mock("../worker/providers/graphhopper.js", () => ({
  snapMeetupWithGraphHopper: async (point: LatLng) => ({ point, distanceMeters: 0 }),
  fetchRouteWithGraphHopper: vi.fn(async ({ start, end }: { start: LatLng; end: LatLng }) => ({
    geometry: Array.from({ length: 1501 }, (_, index) => {
      const ratio = index / 1500;
      return {
        lat: start.lat + (end.lat - start.lat) * ratio,
        lng: start.lng + (end.lng - start.lng) * ratio
      };
    }),
    graphEdgeIds: ["edge-1"],
    distanceKm: 10,
    durationMinutes: 30
  }))
}));

vi.mock("../worker/sessions.js", () => ({
  hashRequest: async () => "request-hash",
  loadRouteSearch: vi.fn(),
  materializePage: async (search: { routes: RouteCandidate[] }) => ({
    searchId: "search",
    routes: search.routes,
    zoneStatuses: [],
    liveDiscoveryStatus: "available",
    graphVersion: "test",
    expiresAt: "2026-06-23T14:00:00.000Z",
    nextPageToken: null
  }),
  newSearchExpiry: () => "2026-06-23T14:00:00.000Z",
  readPageToken: vi.fn(),
  storeRouteSearch: vi.fn()
}));

describe("route-search load example regression", () => {
  it("handles long GraphHopper geometries for the load-example request", async () => {
    const { app } = await import("../worker/index.js");
    const fakeD1 = {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          run: async () => ({})
        })
      })
    };

    const response = await app.request(
      "/api/route-searches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } },
          departureIso: "2026-06-24T10:30:00.000Z",
          participants: [
            {
              id: "1",
              name: "Ariel",
              station: { lat: 1.32403889, lng: 103.93003611 },
              anchor: {
                id: "bedok-mrt",
                name: "Bedok MRT",
                kind: "rail",
                point: { lat: 1.32403889, lng: 103.93003611 },
                distanceFromHomeKm: 0,
                fallbackSuggested: false
              }
            },
            {
              id: "2",
              name: "Ben",
              station: { lat: 1.355, lng: 103.94388889 },
              anchor: {
                id: "tampines-mrt",
                name: "Tampines MRT",
                kind: "rail",
                point: { lat: 1.355, lng: 103.94388889 },
                distanceFromHomeKm: 0,
                fallbackSuggested: false
              }
            },
            {
              id: "3",
              name: "Charis",
              station: { lat: 1.31777778, lng: 103.8925 },
              anchor: {
                id: "paya-lebar-mrt",
                name: "Paya Lebar MRT",
                kind: "rail",
                point: { lat: 1.31777778, lng: 103.8925 },
                distanceFromHomeKm: 0,
                fallbackSuggested: false
              }
            },
            {
              id: "4",
              name: "Deepa",
              station: { lat: 1.40527778, lng: 103.9025 },
              anchor: {
                id: "punggol-mrt-lrt",
                name: "Punggol MRT/LRT",
                kind: "rail",
                point: { lat: 1.40527778, lng: 103.9025 },
                distanceFromHomeKm: 0,
                fallbackSuggested: false
              }
            }
          ]
        })
      },
      {
        TRANSIT_CACHE: fakeD1,
        PAGE_TOKEN_SECRET: "secret",
        GRAPHHOPPER_API_KEY: "hosted-key"
      }
    );
    const payload = (await response.json()) as { routes: RouteCandidate[] };

    expect(response.status).toBe(200);
    expect(payload.routes.length).toBeGreaterThan(0);
    expect(payload.routes.every((route) => route.geometry.length === 1501)).toBe(true);
    expect(payload.routes.every((route) => route.overlapSignature.length === 0)).toBe(true);
  });
});
