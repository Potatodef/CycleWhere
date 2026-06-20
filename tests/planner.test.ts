import { classifyFairness, majorityFriendlySpread, spread } from "../src/lib/fairness.js";
import { buildTransitQueries, generateCuratedCandidates, planRoutes } from "../src/lib/planner.js";
import type { ResolvedParticipant, RouteCandidate, ZoneDiscoveryStatus } from "../src/types.js";

function participant(id: string, name: string, lat: number, lng: number): ResolvedParticipant {
  return {
    id,
    name,
    station: name,
    stationResolution: {
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

function flattenRoutes(sections: { routes: RouteCandidate[] }[]) {
  return sections.flatMap((section) => section.routes);
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
  const start = { label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } };

  it("returns sectioned curated routes sorted by mileage with mixed traffic limited", () => {
    const candidates = generateCuratedCandidates(start);
    const routes = planRoutes({
      candidates,
      participants: [
        participant("a", "A", 1.3249, 103.9303),
        participant("b", "B", 1.3532, 103.944),
        participant("c", "C", 1.3714, 103.893)
      ],
      startTimeIso: "2026-06-18T18:30:00.000Z",
      liveDiscoveryStatus: "unavailable"
    });

    expect(routes.sections.length).toBeGreaterThan(0);
    const firstSection = routes.sections[0];
    const distances = firstSection.routes.map((route) => route.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(flattenRoutes(routes.sections).every((route) => (route.mixedTrafficMeters ?? 0) <= 250)).toBe(
      true
    );
  });

  it("builds transit queries for curated and discovered candidates together", () => {
    const curated = generateCuratedCandidates(start);
    const discovered: RouteCandidate = {
      id: "discovered-1",
      zoneId: "east",
      zoneName: "East corridor",
      source: "discovered",
      profile: "cycling",
      routeName: "Live discovered route",
      endpointName: "Waypoint",
      endpoint: { lat: 1.31, lng: 103.9 },
      endpointAnchor: {
        id: "bus-anchor",
        name: "Bus Anchor",
        kind: "bus",
        point: { lat: 1.309, lng: 103.901 },
        distanceFromHomeKm: 0.2,
        fallbackSuggested: false
      },
      geometry: [start.point, { lat: 1.295, lng: 103.88 }, { lat: 1.31, lng: 103.9 }],
      distanceKm: 6.4,
      cyclingMinutes: 24,
      routeQualityScore: null,
      routeQualitySource: "unknown",
      overlapSignature: ["a->b"]
    };

    const queries = buildTransitQueries({
      candidates: [...curated.slice(0, 1), discovered],
      participants: [participant("a", "A", 1.3249, 103.9303)],
      startTimeIso: "2026-06-18T18:30:00.000Z"
    });

    expect(queries).toHaveLength(2);
    expect(queries[1]?.query.modeHint).toBe("rail");
  });

  it("surfaces trusted corridor matches ahead of curated alternatives when discovery aligns", () => {
    const curated = generateCuratedCandidates(start);
    const match = curated[0]!;
    const routes = planRoutes({
      candidates: [
        match,
        {
          ...match,
          id: "match-discovered",
          source: "discovered",
          routeName: "Live discovered route",
          routeQualityScore: null,
          routeQualitySource: "unknown",
          popularityEvidence: undefined,
          mixedTrafficMeters: undefined,
          pcnCoverage: undefined,
          cyclingPathCoverage: undefined,
          commonCorridorCoverage: undefined
        }
      ],
      participants: [
        participant("north", "North", 1.39, 103.85),
        participant("south", "South", 1.31, 103.85),
        participant("east", "East", 1.35, 103.9),
        participant("center", "Center", 1.35, 103.848)
      ],
      startTimeIso: "2026-06-18T09:00:00.000Z",
      zoneStatuses: [
        {
          zoneId: match.zoneId,
          zoneName: match.zoneName,
          status: "available",
          usedProfile: "cycling",
          candidateCount: 1
        } satisfies ZoneDiscoveryStatus
      ],
      liveDiscoveryStatus: "available"
    });

    expect(routes.sections[0]?.id).toBe("trusted-matches");
    expect(routes.sections[0]?.routes[0]?.matchedCorridorId).toBe(match.corridorId);
  });

  it("drops low-agreement live variants when the trusted corridor is not materially worse", () => {
    const curated = generateCuratedCandidates(start);
    const trusted = curated[0]!;
    const routes = planRoutes({
      candidates: [
        trusted,
        {
          ...trusted,
          id: "weak-live-variant",
          source: "discovered",
          routeName: "Weak live variant",
          routeQualityScore: null,
          routeQualitySource: "unknown",
          overlapSignature: ["far->away"],
          popularityEvidence: undefined,
          mixedTrafficMeters: undefined,
          pcnCoverage: undefined,
          cyclingPathCoverage: undefined,
          commonCorridorCoverage: undefined
        }
      ],
      participants: [
        participant("north", "North", 1.39, 103.85),
        participant("south", "South", 1.31, 103.85),
        participant("east", "East", 1.35, 103.9)
      ],
      startTimeIso: "2026-06-18T09:00:00.000Z",
      liveDiscoveryStatus: "available"
    });

    expect(flattenRoutes(routes.sections).some((route) => route.id === "weak-live-variant")).toBe(false);
  });

  it("can surface uneven majority-friendly routes for clustered homes plus one outlier", () => {
    const routes = planRoutes({
      candidates: generateCuratedCandidates(start),
      participants: [
        participant("a", "A", 1.3249, 103.9303),
        participant("b", "B", 1.3255, 103.931),
        participant("c", "C", 1.3261, 103.929),
        participant("d", "D", 1.3243, 103.928),
        participant("e", "E", 1.4362, 103.7862)
      ],
      startTimeIso: "2026-06-18T18:30:00.000Z",
      liveDiscoveryStatus: "unavailable"
    });

    const unevenSection = routes.sections.find((section) => section.id === "majority-friendly-uneven");
    expect(unevenSection?.routes.length ?? 0).toBeLessThanOrEqual(2);
    expect(unevenSection?.routes.every((route) => route.fairnessSpreadMinutes > 30) ?? true).toBe(true);
  });

  it("keeps fairness based on actual times, not geometry alone", () => {
    const valuesNearCenter = [12, 18, 40, 4];
    const alternative = [18, 24, 26, 21];
    expect(spread(valuesNearCenter)).toBeGreaterThan(spread(alternative));
  });
});
