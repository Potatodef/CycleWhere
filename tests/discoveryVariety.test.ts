import { describe, expect, it } from "vitest";
import { haversineKm } from "../src/lib/geo.js";
import { planRoutes } from "../src/lib/planner.js";
import type { LatLng, ResolvedParticipant, RouteSearchRequest } from "../src/types.js";
import { discoverCyclingRoutes } from "../worker/discovery.js";

function bearingDegrees(start: LatLng, end: LatLng) {
  const y = Math.sin(((end.lng - start.lng) * Math.PI) / 180) * Math.cos((end.lat * Math.PI) / 180);
  const x =
    Math.cos((start.lat * Math.PI) / 180) * Math.sin((end.lat * Math.PI) / 180) -
    Math.sin((start.lat * Math.PI) / 180) *
      Math.cos((end.lat * Math.PI) / 180) *
      Math.cos(((end.lng - start.lng) * Math.PI) / 180);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

function bucketKey(start: LatLng, end: LatLng) {
  const distanceKm = haversineKm(start, end);
  const band = distanceKm < 10 ? 0 : distanceKm < 20 ? 1 : 2;
  const sector = Math.floor(((bearingDegrees(start, end) + 22.5) % 360) / 45);
  return `${band}:${sector}`;
}

describe("real network discovery variety", () => {
  it("keeps hosted-safe route variety from the production verified-network candidates", async () => {
    const request: RouteSearchRequest = {
      start: {
        label: "Marina Bay",
        point: { lat: 1.2808, lng: 103.8545 }
      },
      departureIso: "2026-06-24T10:00:00.000Z",
      participants: [
        {
          id: "east",
          name: "East rider",
          station: { lat: 1.355, lng: 103.94388889 },
          anchor: {
            id: "tampines-mrt",
            name: "Tampines MRT",
            kind: "rail",
            point: { lat: 1.355, lng: 103.94388889 },
            distanceFromHomeKm: 0,
            fallbackSuggested: false
          }
        },
        {
          id: "west",
          name: "West rider",
          station: { lat: 1.31530278, lng: 103.76524444 },
          anchor: {
            id: "clementi-mrt",
            name: "Clementi MRT",
            kind: "rail",
            point: { lat: 1.31530278, lng: 103.76524444 },
            distanceFromHomeKm: 0,
            fallbackSuggested: false
          }
        },
        {
          id: "north",
          name: "North rider",
          station: { lat: 1.35111111, lng: 103.84833333 },
          anchor: {
            id: "bishan-mrt",
            name: "Bishan MRT",
            kind: "rail",
            point: { lat: 1.35111111, lng: 103.84833333 },
            distanceFromHomeKm: 0,
            fallbackSuggested: false
          }
        }
      ]
    };

    const result = await discoverCyclingRoutes(request, {
      maxDiscoveryEndpoints: 6,
      maxDiversityBackfillEndpoints: 2,
      minDiverseRouteBuckets: 4,
      routingProfiles: ["bicycle"],
      fetchRoute: async ({ start, end }) => {
        const distanceKm = haversineKm(start, end);
        return {
          geometry: [
            end,
            { lat: end.lat + 0.00001, lng: end.lng + 0.00001 }
          ],
          graphEdgeIds: [`edge-${end.lat.toFixed(5)}-${end.lng.toFixed(5)}`],
          distanceKm,
          durationMinutes: Math.max(1, Math.round(distanceKm * 3))
        };
      }
    });

    const buckets = new Set(result.routes.map((route) => bucketKey(request.start.point, route.endpoint)));
    expect(result.routes.length).toBeGreaterThanOrEqual(4);
    expect(buckets.size).toBeGreaterThanOrEqual(4);
    expect(result.routes.every((route) => route.distanceKm >= 5 && route.distanceKm <= 35)).toBe(true);
    expect(result.routes.every((route) => (route.verifiedCoverage ?? 0) >= 0.6)).toBe(true);

    const planned = planRoutes({
      candidates: result.routes,
      participants: request.participants.map(
        (participant) =>
          ({
            id: participant.id,
            name: participant.name,
            station: participant.anchor.name,
            stationResolution: {
              query: participant.anchor.name,
              label: participant.anchor.name,
              point: participant.station,
              confidence: "high",
              source: "fallback"
            },
            anchor: participant.anchor
          }) satisfies ResolvedParticipant
      ),
      startTimeIso: request.departureIso,
      zoneStatuses: result.zoneStatuses,
      liveDiscoveryStatus: result.liveDiscoveryStatus
    });
    const plannedRoutes = planned.sections.flatMap((section) => section.routes);
    const plannedBuckets = new Set(plannedRoutes.map((route) => bucketKey(request.start.point, route.endpoint)));
    expect(plannedRoutes.length).toBeGreaterThanOrEqual(3);
    expect(plannedBuckets.size).toBeGreaterThanOrEqual(3);
  });
});
