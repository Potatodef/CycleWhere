import networkManifest from "../public/data/network-manifest.json";
import verifiedNetwork from "../public/data/verified-network.json";

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
});
