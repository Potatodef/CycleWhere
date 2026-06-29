import networkManifest from "../public/data/network-manifest.json";
import verifiedNetwork from "../public/data/verified-network.json";
import {
  listVerifiedBusAnchors,
  MAX_COVERAGE_SAMPLES,
  measureRouteCoverage,
  sampleRouteCoveragePoints
} from "../src/lib/verifiedNetwork.js";
import type { LatLng } from "../src/types.js";

function longGeometry(pointCount: number): LatLng[] {
  return Array.from({ length: pointCount }, (_, index) => ({
    lat: 1.28 + index * 0.00008,
    lng: 103.85 + index * 0.00008
  }));
}

describe("verified network asset", () => {
  it("contains only official datasets and named official routes", () => {
    expect(verifiedNetwork.datasets.map((dataset) => dataset.datasetId).sort()).toEqual([
      "d_8f468b25193f64be8a16fa7d8f60f553",
      "d_a69ef89737379f231d2ae93fd1c5707f",
      "nparks:park-connector-trails:eastern-corridor",
      "nparks:park-connector-trails:rail-corridor",
      "nparks:park-connector-trails:round-island-route"
    ]);
  });

  it("ships non-empty verified segments and candidate points", () => {
    expect(verifiedNetwork.segments.length).toBeGreaterThan(0);
    expect(verifiedNetwork.candidatePoints.length).toBeGreaterThan(0);
    expect(verifiedNetwork.segments.every((segment) => ["cycling-path", "park-connector"].includes(segment.kind))).toBe(true);
  });

  it("keeps the manifest counts in sync", () => {
    expect(networkManifest.segmentCount).toBe(verifiedNetwork.segments.length);
    expect(networkManifest.candidatePointCount).toBe(verifiedNetwork.candidatePoints.length);
    expect(networkManifest.namedRouteCount).toBe(verifiedNetwork.namedRoutes.length);
    expect(networkManifest.busAnchorCount).toBe(verifiedNetwork.busAnchors.length);
  });

  it("deduplicates bus anchors exposed to route discovery by stop id", () => {
    const busAnchors = listVerifiedBusAnchors();
    expect(new Set(busAnchors.map((anchor) => anchor.id)).size).toBe(busAnchors.length);
    expect(busAnchors.length).toBeLessThanOrEqual(verifiedNetwork.busAnchors.length);
  });

  it("caps coverage samples for long route geometries", () => {
    const sampled = sampleRouteCoveragePoints(longGeometry(1501));

    expect(sampled.points.length).toBeLessThanOrEqual(MAX_COVERAGE_SAMPLES);
    expect(sampled.distanceKm).toBeGreaterThan(0);
  });

  it("measures long route coverage without unbounded sampling", () => {
    const coverage = measureRouteCoverage(longGeometry(1501));

    expect(coverage.verifiedCoverage).toBeGreaterThanOrEqual(0);
    expect(coverage.verifiedCoverage).toBeLessThanOrEqual(1);
    expect(coverage.mixedTrafficMeters).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(coverage.sourceDatasets)).toBe(true);
    expect(Array.isArray(coverage.sourceFeatureIds)).toBe(true);
  });
});
