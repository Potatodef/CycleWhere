import { describe, expect, it } from "vitest";
import { MAX_ROUTE_SIGNATURE_SEGMENTS, routeSignature } from "../src/lib/routeUtils.js";
import type { LatLng } from "../src/types.js";

function longGeometry(pointCount: number): LatLng[] {
  return Array.from({ length: pointCount }, (_, index) => ({
    lat: 1 + index * 0.001,
    lng: 103 + index * 0.001
  }));
}

describe("route utilities", () => {
  it("keeps short route signatures exact", () => {
    expect(
      routeSignature([
        { lat: 1.1, lng: 103.1 },
        { lat: 1.2, lng: 103.2 },
        { lat: 1.3, lng: 103.3 }
      ])
    ).toEqual(["1.1000,103.1000->1.2000,103.2000", "1.2000,103.2000->1.3000,103.3000"]);
  });

  it("keeps nearby parallel corridors distinct", () => {
    const base = [
      { lat: 1.3, lng: 103.8 },
      { lat: 1.305, lng: 103.805 },
      { lat: 1.31, lng: 103.81 }
    ];
    const shifted = base.map((point) => ({
      lat: point.lat + 0.0004,
      lng: point.lng
    }));

    expect(routeSignature(base)).not.toEqual(routeSignature(shifted));
  });

  it("bounds long route signatures while preserving endpoints", () => {
    const signature = routeSignature(longGeometry(1501));

    expect(signature).toHaveLength(MAX_ROUTE_SIGNATURE_SEGMENTS);
    expect(signature[0]).toBe("1.0000,103.0000->1.0010,103.0010");
    expect(signature.at(-1)).toBe("2.4990,104.4990->2.5000,104.5000");
    expect(routeSignature(longGeometry(1501))).toEqual(signature);
  });
});
