import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeSignature } from "../src/lib/routeUtils.js";
import type { LatLng, RouteCandidate } from "../src/types.js";

const discoverCyclingRoutes = vi.fn();
const loadRouteSearch = vi.fn();
const readPageToken = vi.fn();
const storeRouteSearch = vi.fn();

vi.mock("../worker/discovery.js", () => ({
  discoverCyclingRoutes
}));

vi.mock("../worker/providers/graphhopper.js", () => ({
  snapMeetupWithGraphHopper: async (point: LatLng) => ({ point, distanceMeters: 0 }),
  fetchRouteWithGraphHopper: vi.fn()
}));

vi.mock("../worker/sessions.js", () => ({
  hashRequest: async () => "request-hash",
  loadRouteSearch,
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
  readPageToken,
  storeRouteSearch
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

function longGeometry(pointCount: number): LatLng[] {
  return Array.from({ length: pointCount }, (_, index) => ({
    lat: 1.2808 + index * 0.00003,
    lng: 103.8545 + index * 0.00003
  }));
}

describe("route-search worker", () => {
  beforeEach(() => {
    loadRouteSearch.mockReset();
    readPageToken.mockReset();
    storeRouteSearch.mockReset();
  });

  it("caps hosted GraphHopper discovery to protect the daily credit budget", async () => {
    let maxDiscoveryEndpoints: number | undefined = 0;
    let maxDiversityBackfillEndpoints: number | undefined = 0;
    let maxFallbackEndpoints: number | undefined = 0;
    let minDiverseRouteBuckets: number | undefined = 0;
    let routingProfiles: string[] | undefined;
    discoverCyclingRoutes.mockImplementationOnce(async (_request, deps) => {
      maxDiscoveryEndpoints = deps.maxDiscoveryEndpoints;
      maxDiversityBackfillEndpoints = deps.maxDiversityBackfillEndpoints;
      maxFallbackEndpoints = deps.maxFallbackEndpoints;
      minDiverseRouteBuckets = deps.minDiverseRouteBuckets;
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
    expect(maxDiversityBackfillEndpoints).toBe(2);
    expect(maxFallbackEndpoints).toBe(4);
    expect(minDiverseRouteBuckets).toBe(4);
    expect(routingProfiles).toEqual(["bicycle"]);
  });

  it("strips route signatures from materialized route-search payloads", async () => {
    discoverCyclingRoutes.mockImplementationOnce(async () => ({
      routes: [{ ...candidate(), overlapSignature: ["large-signature-entry"] }],
      diagnostics: [],
      zoneStatuses: [],
      liveDiscoveryStatus: "available",
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
    expect(payload.routes[0]?.overlapSignature).toEqual([]);
  });

  it("materializes long geometry routes without returning large signatures", async () => {
    const geometry = longGeometry(1501);
    discoverCyclingRoutes.mockImplementationOnce(async () => ({
      routes: [
        {
          ...candidate(),
          geometry,
          overlapSignature: routeSignature(geometry)
        }
      ],
      diagnostics: [],
      zoneStatuses: [],
      liveDiscoveryStatus: "available",
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
    expect(payload.routes[0]?.geometry).toHaveLength(1501);
    expect(payload.routes[0]?.overlapSignature).toEqual([]);
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

  it("dedupes duplicate discovered route IDs before materializing results", async () => {
    discoverCyclingRoutes.mockImplementationOnce(async () => ({
      routes: [
        candidate(),
        {
          ...candidate(),
          distanceKm: 12,
          cyclingMinutes: 42,
          geometry: [
            { lat: 1.2808, lng: 103.8545 },
            { lat: 1.355, lng: 103.94388889 }
          ]
        }
      ],
      diagnostics: [],
      zoneStatuses: [],
      liveDiscoveryStatus: "available",
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
    expect(payload.routes).toHaveLength(1);
    expect(payload.routes[0]?.distanceKm).toBe(8);
  });

  it("surfaces a routing error when a route-search session cannot be saved", async () => {
    storeRouteSearch.mockRejectedValueOnce(new Error("D1 write failed"));
    discoverCyclingRoutes.mockImplementationOnce(async () => ({
      routes: [candidate()],
      diagnostics: [],
      zoneStatuses: [],
      liveDiscoveryStatus: "available",
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
    const payload = (await response.json()) as { code: string };

    expect(response.status).toBe(503);
    expect(payload.code).toBe("routing_unavailable");
  });

  it("surfaces a routing error when a route-search page cannot be loaded", async () => {
    readPageToken.mockResolvedValueOnce({
      sessionId: "search",
      startIndex: 6,
      expiresAt: "2099-06-23T14:00:00.000Z",
      graphVersion: "test"
    });
    loadRouteSearch.mockRejectedValueOnce(new Error("D1 read failed"));
    const { app } = await import("../worker/index.js");

    const response = await app.request(
      "/api/route-searches/page?token=valid-token",
      { method: "GET" },
      {
        TRANSIT_CACHE: {},
        PAGE_TOKEN_SECRET: "secret"
      }
    );
    const payload = (await response.json()) as { code: string };

    expect(response.status).toBe(503);
    expect(payload.code).toBe("routing_unavailable");
  });
});
