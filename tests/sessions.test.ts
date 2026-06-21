import {
  createPageToken,
  materializePage,
  newSearchExpiry,
  readPageToken,
  type MaterializedRouteSearch
} from "../worker/sessions.js";
import type { RouteCandidate } from "../src/types.js";

function candidate(id: string): RouteCandidate {
  return {
    id,
    source: "verified-network",
    origin: "network-endpoint",
    profile: "bicycle",
    routeName: id,
    endpointName: id,
    endpoint: { lat: 1.3, lng: 103.8 },
    endpointAnchor: {
      id: `${id}-anchor`,
      name: "MRT",
      kind: "rail",
      point: { lat: 1.3, lng: 103.8 },
      distanceFromHomeKm: 0,
      fallbackSuggested: false
    },
    geometry: [{ lat: 1.3, lng: 103.8 }],
    distanceKm: 5,
    cyclingMinutes: 20,
    sourceDatasets: [],
    sourceFeatureIds: [],
    routeQualitySource: "measured",
    overlapSignature: []
  };
}

describe("immutable route-search pages", () => {
  it("rejects a modified page token", async () => {
    const token = await createPageToken(
      { sessionId: "search", startIndex: 6, expiresAt: newSearchExpiry(), graphVersion: "v1" },
      "test-secret"
    );
    expect(await readPageToken(`${token}x`, "test-secret")).toBeNull();
  });

  it("returns byte-equivalent pages for the same immutable cursor", async () => {
    const search: MaterializedRouteSearch = {
      searchId: "search",
      graphVersion: "v1",
      profileHash: "p1",
      overlayHash: "o1",
      rankingHash: "r1",
      requestHash: "request",
      snappedStart: { lat: 1.3, lng: 103.8 },
      expiresAt: newSearchExpiry(),
      routes: Array.from({ length: 8 }, (_, index) => candidate(`route-${index}`)),
      diagnostics: [],
      zoneStatuses: [],
      liveDiscoveryStatus: "available"
    };
    const first = await materializePage(search, 0, "test-secret");
    const repeated = await materializePage(search, 0, "test-secret");
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(first));
    expect(first.routes).toHaveLength(6);
    expect(first.nextPageToken).toBeTruthy();
  });
});
