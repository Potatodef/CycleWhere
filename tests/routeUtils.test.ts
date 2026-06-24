import { describe, expect, it } from "vitest";
import { routeSignature } from "../src/lib/routeUtils.js";

describe("routeSignature", () => {
  it("keeps nearby parallel corridors distinct", () => {
    const base = [
      { lat: 1.3000, lng: 103.8000 },
      { lat: 1.3050, lng: 103.8050 },
      { lat: 1.3100, lng: 103.8100 }
    ];
    const shifted = base.map((point) => ({
      lat: point.lat + 0.0004,
      lng: point.lng
    }));

    expect(routeSignature(base)).not.toEqual(routeSignature(shifted));
  });
});
