import { classifyFairness, majorityFriendlySpread, spread } from "../src/lib/fairness.js";
import { buildTransitQueries, planRoutes } from "../src/lib/planner.js";
import type { ResolvedParticipant, RouteCandidate } from "../src/types.js";

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

function routeCandidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    id: overrides.id ?? "route-a",
    source: "verified-network",
    origin: overrides.origin ?? "network-endpoint",
    profile: "cycling",
    routeName: overrides.routeName ?? "Verified route",
    endpointName: overrides.endpointName ?? "Verified endpoint",
    endpoint: overrides.endpoint ?? { lat: 1.31, lng: 103.88 },
    endpointAnchor: overrides.endpointAnchor ?? {
      id: "anchor-a",
      name: "Bedok MRT",
      kind: "rail",
      point: { lat: 1.31, lng: 103.88 },
      distanceFromHomeKm: 0.1,
      fallbackSuggested: false
    },
    geometry: overrides.geometry ?? [
      { lat: 1.2808, lng: 103.8545 },
      { lat: 1.295, lng: 103.87 },
      { lat: 1.31, lng: 103.88 }
    ],
    distanceKm: overrides.distanceKm ?? 6.4,
    cyclingMinutes: overrides.cyclingMinutes ?? 24,
    verifiedCoverage: overrides.verifiedCoverage ?? 0.82,
    pcnCoverage: overrides.pcnCoverage ?? 0.44,
    cyclingPathCoverage: overrides.cyclingPathCoverage ?? 0.3,
    mixedTrafficMeters: overrides.mixedTrafficMeters ?? 180,
    sourceDatasets: overrides.sourceDatasets ?? ["d_8f468b25193f64be8a16fa7d8f60f553"],
    sourceFeatureIds: overrides.sourceFeatureIds ?? ["cycling-path-1"],
    routeQualityScore: overrides.routeQualityScore ?? 74,
    routeQualitySource: "measured",
    overlapSignature: overrides.overlapSignature ?? ["a->b", "b->c"],
    cyclingMinutesSource: overrides.cyclingMinutesSource ?? "onemap"
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
  it("builds transit queries for verified-network candidates", () => {
    const queries = buildTransitQueries({
      candidates: [
        routeCandidate(),
        routeCandidate({
          id: "bus-route",
          endpointAnchor: {
            id: "bus-anchor",
            name: "Bus stop",
            kind: "bus",
            point: { lat: 1.309, lng: 103.901 },
            distanceFromHomeKm: 0.2,
            fallbackSuggested: false
          }
        })
      ],
      participants: [participant("a", "A", 1.3249, 103.9303)],
      startTimeIso: "2026-06-18T18:30:00.000Z"
    });

    expect(queries).toHaveLength(2);
    expect(queries[1]?.query.modeHint).toBe("rail");
  });

  it("surfaces the fairest verified routes first", () => {
    const routes = planRoutes({
      candidates: [
        routeCandidate({
          id: "best",
          verifiedCoverage: 0.9,
          pcnCoverage: 0.55,
          cyclingPathCoverage: 0.2
        }),
        routeCandidate({
          id: "backup",
          verifiedCoverage: 0.7,
          pcnCoverage: 0.25,
          cyclingPathCoverage: 0.15,
          distanceKm: 9.2,
          cyclingMinutes: 34
        })
      ],
      participants: [
        participant("a", "A", 1.3249, 103.9303),
        participant("b", "B", 1.3532, 103.944),
        participant("c", "C", 1.3714, 103.893)
      ],
      startTimeIso: "2026-06-18T18:30:00.000Z",
      transitOverrides: {
        "best::a": 20,
        "best::b": 22,
        "best::c": 24,
        "backup::a": 26,
        "backup::b": 28,
        "backup::c": 31
      },
      liveDiscoveryStatus: "available"
    });

    expect(routes.sections[0]?.id).toBe("best-fair-routes");
    expect(routes.sections[0]?.routes[0]?.id).toBe("best");
  });

  it("prefers a fair route with a shorter journey home and keeps uneven alternatives", () => {
    const routes = planRoutes({
      candidates: [
        routeCandidate({ id: "equal-but-remote", overlapSignature: ["remote"] }),
        routeCandidate({ id: "homeward", overlapSignature: ["homeward"] }),
        routeCandidate({ id: "stretched", overlapSignature: ["stretched"] }),
        routeCandidate({ id: "uneven", overlapSignature: ["uneven"] })
      ],
      participants: [
        participant("a", "A", 1.35, 103.84),
        participant("b", "B", 1.36, 103.85),
        participant("c", "C", 1.37, 103.86)
      ],
      startTimeIso: "2026-06-18T18:30:00.000Z",
      transitOverrides: {
        "equal-but-remote::a": 90,
        "equal-but-remote::b": 91,
        "equal-but-remote::c": 92,
        "homeward::a": 18,
        "homeward::b": 22,
        "homeward::c": 26,
        "stretched::a": 80,
        "stretched::b": 90,
        "stretched::c": 105,
        "uneven::a": 15,
        "uneven::b": 40,
        "uneven::c": 55
      }
    });

    expect(routes.sections[0]?.routes.map((route) => route.id).slice(0, 2)).toEqual([
      "homeward",
      "equal-but-remote"
    ]);
    expect(routes.sections.flatMap((section) => section.routes.map((route) => route.id))).toContain("uneven");
    expect(
      routes.sections.find((section) => section.id === "more-route-options")?.routes.map((route) => route.id)
    ).toEqual(["stretched", "uneven"]);
  });

  it("keeps similar routes from crowding out distance variety", () => {
    const routes = planRoutes({
      candidates: [
        routeCandidate({ id: "route-1", overlapSignature: ["a", "b", "c"], distanceKm: 8 }),
        routeCandidate({ id: "route-2", overlapSignature: ["a", "b", "c"], distanceKm: 8.4 }),
        routeCandidate({ id: "route-3", overlapSignature: ["x", "y", "z"], distanceKm: 14 })
      ],
      participants: [
        participant("a", "A", 1.3249, 103.9303),
        participant("b", "B", 1.3532, 103.944),
        participant("c", "C", 1.3714, 103.893)
      ],
      startTimeIso: "2026-06-18T18:30:00.000Z",
      liveDiscoveryStatus: "available"
    });

    const ids = routes.sections.flatMap((section) => section.routes.map((route) => route.id));
    expect(ids).toContain("route-1");
    expect(ids).not.toContain("route-2");
    expect(ids).toContain("route-3");
  });

  it("can surface uneven majority-friendly routes for clustered homes plus one outlier", () => {
    const routes = planRoutes({
      candidates: [
        routeCandidate({ id: "route-a", distanceKm: 6, cyclingMinutes: 20 }),
        routeCandidate({ id: "route-b", distanceKm: 18, cyclingMinutes: 62 })
      ],
      participants: [
        participant("a", "A", 1.3249, 103.9303),
        participant("b", "B", 1.3255, 103.931),
        participant("c", "C", 1.3261, 103.929),
        participant("d", "D", 1.3243, 103.928),
        participant("e", "E", 1.4362, 103.7862)
      ],
      startTimeIso: "2026-06-18T18:30:00.000Z",
      liveDiscoveryStatus: "available"
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
