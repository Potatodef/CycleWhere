import { describe, expect, it } from "vitest";
import { findExactStation, getStationRecommendations } from "../src/lib/stations.js";

describe("getStationRecommendations", () => {
  it("falls back to close typo matches when substring matching finds nothing", () => {
    expect(getStationRecommendations("Beok")).toContain("Bedok MRT");
  });

  it("accepts MRT-only input for MRT/LRT stations", () => {
    expect(findExactStation("Bukit Panjang MRT")?.name).toBe("Bukit Panjang MRT/LRT");
  });
});
