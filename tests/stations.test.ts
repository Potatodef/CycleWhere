import { describe, expect, it } from "vitest";
import { getStationRecommendations } from "../src/lib/stations.js";

describe("getStationRecommendations", () => {
  it("falls back to close typo matches when substring matching finds nothing", () => {
    expect(getStationRecommendations("Beok")).toContain("Bedok MRT");
  });
});
