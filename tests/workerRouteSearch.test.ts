import { describe, expect, it, vi } from "vitest";
import type { LatLng, RouteCandidate } from "../src/types.js";

const discoverCyclingRoutes = vi.fn();

vi.mock("../worker/discovery.js", () => ({
  discoverCyclingRoutes
}));

vi.mock("../worker/providers/graphhopper.js", () => ({
  snapMeetupWithGraphHopper: async (point: LatLng) => ({ point, distanceMeters: 0 }),
  fetchRouteWithGraphHopper: vi.fn()
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

function candidate(): RouteCandidate {
  return {
    id: "route-a",
    source: "verified-network",
    origin: "network-endpoint",
    profile: "bicycle",
    routeName: "Route A",
    endpointName: "Bedok MRT",
    endpoint: { lat: 1.32403889, lng: 103.93003611 },
    endpointAnchor: {
      id: "bedok-mrt",
      name: "Bedok MRT",
      kind: "rail",
      point: { lat: 1.32403889, lng: 103.93003611 },
      distanceFromHomeKm: 0,
      fallbackSuggested: false
    },
    geometry: [
      { lat: 1.2808, lng: 103.8545 },
      { lat: 1.32403889, lng: 103.93003611 }
    ],
    distanceKm: 8,
    cyclingMinutes: 28,
    sourceDatasets: [],
    sourceFeatureIds: [],
    routeQualitySource: "measured",
    overlapSignature: []
  };
}

describe("route-search worker", () => {
  it("caps hosted GraphHopper discovery to protect the daily credit budget", async () => {
    let maxDiscoveryEndpoints: number | undefined = 0;
    let maxDiversityBackfillEndpoints: number | undefined = 0;
    let maxFallbackEndpoints: number | undefined = 0;
    let routingProfiles: string[] | undefined;
    discoverCyclingRoutes.mockImplementationOnce(async (_request, deps) => {
      maxDiscoveryEndpoints = deps.maxDiscoveryEndpoints;
      maxDiversityBackfillEndpoints = deps.maxDiversityBackfillEndpoints;
      maxFallbackEndpoints = deps.maxFallbackEndpoints;
      routingProfiles = deps.routingProfiles;
      return {
        routes: [candidate()],
        diagnostics: [],
        zoneStatuses: [],
        liveDiscoveryStatus: "available",
        graphVersion: "test"
      };
    });
    const { app } = await import("../worker/index.js");

    const response = await app.request(
      "/api/route-searches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } },
          departureIso: "2026-06-23T13:30:00.000Z",
          participants: [
            {
              id: "a",
              name: "A",
              station: { lat: 1.32403889, lng: 103.93003611 },
              anchor: {
                id: "bedok-mrt",
                name: "Bedok MRT",
                kind: "rail",
                point: { lat: 1.32403889, lng: 103.93003611 },
                distanceFromHomeKm: 0,
                fallbackSuggested: false
              }
            }
          ]
        })
      },
      {
        TRANSIT_CACHE: {},
        PAGE_TOKEN_SECRET: "secret",
        GRAPHHOPPER_API_KEY: "hosted-key"
      }
    );

    expect(response.status).toBe(200);
    expect(maxDiscoveryEndpoints).toBe(6);
    expect(maxDiversityBackfillEndpoints).toBe(6);
    expect(maxFallbackEndpoints).toBe(4);
    expect(routingProfiles).toEqual(["bicycle"]);
  });

  it("returns an empty route result instead of failing when discovery finds nothing", async () => {
    discoverCyclingRoutes.mockImplementationOnce(async () => ({
      routes: [],
      diagnostics: [],
      zoneStatuses: [],
      liveDiscoveryStatus: "unavailable",
      graphVersion: "test"
    }));
    const { app } = await import("../worker/index.js");

    const response = await app.request(
      "/api/route-searches",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: { label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } },
          departureIso: "2026-06-23T13:30:00.000Z",
          participants: [
            {
              id: "a",
              name: "A",
              station: { lat: 1.32403889, lng: 103.93003611 },
              anchor: {
                id: "bedok-mrt",
                name: "Bedok MRT",
                kind: "rail",
                point: { lat: 1.32403889, lng: 103.93003611 },
                distanceFromHomeKm: 0,
                fallbackSuggested: false
              }
            }
          ]
        })
      },
      {
        TRANSIT_CACHE: {},
        PAGE_TOKEN_SECRET: "secret",
        GRAPHHOPPER_API_KEY: "hosted-key"
      }
    );
    const payload = (await response.json()) as { routes: RouteCandidate[] };

    expect(response.status).toBe(200);
    expect(payload.routes).toEqual([]);
  });
});
