import { anchorSeeds } from "../src/data/anchors.js";
import { findRailStation, railStationSeeds, snapMeetupPointToLand } from "../src/lib/anchors.js";
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

  it("keeps the transport anchor list populated", () => {
    expect(anchorSeeds.length).toBeGreaterThan(0);
  });

  it("snaps obviously offshore meetup points to the nearest known land anchor", () => {
    const snapped = snapMeetupPointToLand({ lat: 1.24, lng: 103.85 }, "Current location");
    expect(snapped.snapped).toBe(true);
    expect(snapped.point).not.toEqual({ lat: 1.24, lng: 103.85 });
  });
});
