import { classifyFairness, majorityFriendlySpread, spread } from "../src/lib/fairness.js";
import { planRoutes } from "../src/lib/planner.js";
import type { ResolvedParticipant } from "../src/types.js";

function participant(id: string, name: string, lat: number, lng: number): ResolvedParticipant {
  return {
    id,
    name,
    address: name,
    home: {
      query: name,
      label: name,
      point: { lat, lng },
      confidence: "high",
      source: "fallback"
    },
    anchor: {
      id: `${id}-anchor`,
      name: `${name} MRT`,
      kind: "rail",
      point: { lat, lng },
      distanceFromHomeKm: 0.2,
      fallbackSuggested: false
    }
  };
}

describe("fairness", () => {
  it("classifies the documented boundaries", () => {
    expect(classifyFairness(9)).toBe("Excellent");
    expect(classifyFairness(10)).toBe("Fair");
    expect(classifyFairness(19)).toBe("Fair");
    expect(classifyFairness(20)).toBe("Stretched");
    expect(classifyFairness(30)).toBe("Stretched");
    expect(classifyFairness(31)).toBe("Uneven");
  });

  it("detects majority-friendly outliers only for groups of four or more", () => {
    expect(majorityFriendlySpread([20, 21, 22, 60])).toBe(true);
    expect(majorityFriendlySpread([20, 21, 60])).toBe(false);
  });
});

describe("planner", () => {
  it("returns routes sorted by mileage with mixed traffic limited", () => {
    const routes = planRoutes({
      start: { label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } },
      participants: [
        participant("a", "A", 1.3249, 103.9303),
        participant("b", "B", 1.3532, 103.944),
        participant("c", "C", 1.3714, 103.893)
      ],
      startTimeIso: "2026-06-18T18:30:00.000Z"
    });

    expect(routes.primary.length).toBeGreaterThan(0);
    const distances = routes.primary.map((route) => route.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(routes.primary.every((route) => route.mixedTrafficMeters <= 250)).toBe(true);
  });

  it("allows a central endpoint when travel times make it fairest", () => {
    const routes = planRoutes({
      start: { label: "Bishan", point: { lat: 1.351, lng: 103.848 } },
      participants: [
        participant("north", "North", 1.39, 103.85),
        participant("south", "South", 1.31, 103.85),
        participant("east", "East", 1.35, 103.9),
        participant("center", "Center", 1.35, 103.848)
      ],
      startTimeIso: "2026-06-18T09:00:00.000Z"
    });

    expect(routes.primary.some((route) => route.endpointName === "Bishan-Ang Mo Kio Park")).toBe(true);
  });

  it("can surface uneven majority-friendly routes for clustered homes plus one outlier", () => {
    const routes = planRoutes({
      start: { label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } },
      participants: [
        participant("a", "A", 1.3249, 103.9303),
        participant("b", "B", 1.3255, 103.931),
        participant("c", "C", 1.3261, 103.929),
        participant("d", "D", 1.3243, 103.928),
        participant("e", "E", 1.4362, 103.7862)
      ],
      startTimeIso: "2026-06-18T18:30:00.000Z"
    });

    expect(routes.uneven.length).toBeLessThanOrEqual(2);
    expect(routes.uneven.every((route) => route.fairnessSpreadMinutes > 30)).toBe(true);
  });

  it("keeps fairness based on actual times, not geometry alone", () => {
    const valuesNearCenter = [12, 18, 40, 4];
    const alternative = [18, 24, 26, 21];
    expect(spread(valuesNearCenter)).toBeGreaterThan(spread(alternative));
  });
});
