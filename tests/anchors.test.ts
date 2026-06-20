import { anchorSeeds } from "../src/data/anchors.js";
import { corridorSeeds } from "../src/data/corridors.js";
import { findRailStation, railStationSeeds } from "../src/lib/anchors.js";
import { fallbackResolve } from "../src/lib/geocodeFallback.js";

describe("rail station seeds", () => {
  it("covers the operational MRT and LRT network", () => {
    expect(railStationSeeds.length).toBeGreaterThanOrEqual(181);
  });

  it("matches MRT and LRT stations even when the suffix is omitted", () => {
    expect(findRailStation("Bukit Panjang")?.name).toBe("Bukit Panjang MRT/LRT");
    expect(findRailStation("Damai")?.name).toBe("Damai LRT");
    expect(findRailStation("Choa Chu Kang MRT")?.name).toBe("Choa Chu Kang MRT/LRT");
  });

  it("treats nonsense meetup inputs as low-confidence fallbacks", () => {
    expect(fallbackResolve("NotARealPlaceZXQ123").confidence).toBe("low");
  });

  it("resolves every corridor preferred anchor id", () => {
    expect(
      corridorSeeds.every((corridor) =>
        anchorSeeds.some((anchor) => anchor.id === corridor.preferredAnchorId)
      )
    ).toBe(true);
  });
});
