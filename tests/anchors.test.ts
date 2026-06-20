import { findRailStation, railStationSeeds } from "../src/lib/anchors.js";

describe("rail station seeds", () => {
  it("covers the operational MRT and LRT network", () => {
    expect(railStationSeeds.length).toBeGreaterThanOrEqual(181);
  });

  it("matches MRT and LRT stations even when the suffix is omitted", () => {
    expect(findRailStation("Bukit Panjang")?.name).toBe("Bukit Panjang MRT/LRT");
    expect(findRailStation("Damai")?.name).toBe("Damai LRT");
    expect(findRailStation("Choa Chu Kang MRT")?.name).toBe("Choa Chu Kang MRT/LRT");
  });
});
