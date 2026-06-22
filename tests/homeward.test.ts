import { homewardScore, medianHomeCentre, projectSvy21 } from "../src/lib/homeward.js";

describe("homeward discovery", () => {
  it("uses a coordinate median that resists one distant rider", () => {
    const centre = medianHomeCentre([
      { lat: 1.35, lng: 103.84 },
      { lat: 1.351, lng: 103.841 },
      { lat: 1.352, lng: 103.842 },
      { lat: 1.44, lng: 103.99 }
    ]);
    expect(centre.lat).toBeCloseTo(1.3515, 4);
    expect(centre.lng).toBeCloseTo(103.8415, 4);
  });

  it("projects Singapore coordinates and ranks the homeward direction first", () => {
    const start = { lat: 1.3, lng: 103.82 };
    const home = { lat: 1.36, lng: 103.9 };
    const projected = projectSvy21(start);
    expect(projected.east).toBeGreaterThan(0);
    expect(projected.north).toBeGreaterThan(0);
    expect(homewardScore(start, { lat: 1.34, lng: 103.88 }, home)).toBeGreaterThan(
      homewardScore(start, { lat: 1.27, lng: 103.75 }, home)
    );
  });

  it("disables orientation when the home centre is within one kilometre", () => {
    const start = { lat: 1.3, lng: 103.82 };
    expect(homewardScore(start, { lat: 1.4, lng: 103.95 }, { lat: 1.301, lng: 103.821 })).toBe(0);
  });
});
