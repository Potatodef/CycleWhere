import { corridorSeeds } from "../src/data/corridors.js";
import { resolveTransportAnchor } from "../src/lib/anchors.js";
import { haversineKm } from "../src/lib/geo.js";
import type {
  DiscoverRoutesRequest,
  DiscoveredRoutesResponse,
  LatLng,
  RouteCandidate,
  RouteQualitySource,
  RoutingProfile,
  TransportAnchor,
  ZoneDiscoveryStatus
} from "../src/types.js";

type RouteResponse = {
  geometry: LatLng[];
  distanceKm: number;
  durationMinutes: number;
};

type DiscoveryDeps = {
  fetchRoute: (input: {
    start: LatLng;
    end: LatLng;
    profile: RoutingProfile;
  }) => Promise<RouteResponse | null>;
  getNearbyTransport: (point: LatLng) => Promise<{
    rails: TransportAnchor[];
    buses: TransportAnchor[];
  }>;
};

type SamplePoint = {
  point: LatLng;
  geometry: LatLng[];
  distanceKm: number;
  durationMinutes: number;
  harvestedIndex: number;
};

function averagePoint(points: LatLng[]) {
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length
  };
}

function cumulativeDistances(points: LatLng[]) {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + haversineKm(points[index - 1], points[index]));
  }
  return distances;
}

function routeSignature(points: LatLng[]) {
  const signature: string[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    signature.push(
      `${previous.lat.toFixed(3)},${previous.lng.toFixed(3)}->${current.lat.toFixed(
        3
      )},${current.lng.toFixed(3)}`
    );
  }
  return signature;
}

function sampleSpine(points: LatLng[], totalMinutes: number) {
  const distances = cumulativeDistances(points);
  const totalDistance = distances[distances.length - 1] ?? 0;

  if (points.length < 4 || totalDistance <= 1) {
    return [];
  }

  const fractions = [0.35, 0.55, 0.75];
  return fractions
    .map((fraction, harvestedIndex) => {
      const targetDistance = totalDistance * fraction;
      const index = distances.findIndex((distance) => distance >= targetDistance);
      if (index <= 1) {
        return null;
      }

      const geometry = points.slice(0, index + 1);
      const distanceKm = Math.round((distances[index] ?? totalDistance) * 10) / 10;
      return {
        point: geometry[geometry.length - 1],
        geometry,
        distanceKm,
        durationMinutes: Math.max(1, Math.round(totalMinutes * (distanceKm / totalDistance))),
        harvestedIndex
      } satisfies SamplePoint;
    })
    .filter((point): point is SamplePoint => Boolean(point));
}

function pickEndpointAnchor(point: LatLng, nearby: { rails: TransportAnchor[]; buses: TransportAnchor[] }) {
  const nearestRail = nearby.rails
    .map((anchor) => ({ anchor, distanceKm: haversineKm(point, anchor.point) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const nearestBus = nearby.buses
    .map((anchor) => ({ anchor, distanceKm: haversineKm(point, anchor.point) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  if (nearestRail && nearestRail.distanceKm <= 1) {
    return {
      anchor: {
        ...nearestRail.anchor,
        distanceFromHomeKm: nearestRail.distanceKm
      },
      eligible: true
    };
  }

  if (nearestBus && nearestBus.distanceKm <= 0.4) {
    return {
      anchor: {
        ...nearestBus.anchor,
        distanceFromHomeKm: nearestBus.distanceKm
      },
      eligible: true
    };
  }

  return {
    anchor: resolveTransportAnchor(point),
    eligible: false
  };
}

function zoneReason(
  profile: RoutingProfile | null,
  candidates: RouteCandidate[],
  fallbackReason: string | undefined
) {
  if (candidates.length > 0) {
    return undefined;
  }
  if (profile === "walk_discovery") {
    return "Walking spine found, but no cycling-valid waypoint survived filtering.";
  }
  return fallbackReason || "No transport-viable discovered waypoints for this zone.";
}

export async function discoverCyclingRoutes(
  request: DiscoverRoutesRequest,
  deps: DiscoveryDeps
): Promise<DiscoveredRoutesResponse> {
  const groupCentroid = averagePoint(request.participants.map((participant) => participant.home));

  const zoneResults = await Promise.allSettled(
    corridorSeeds.map(async (corridor) => {
      let usedProfile: RoutingProfile | null = "cycling";
      let fallbackReason: string | undefined;

      const primarySpine = await deps.fetchRoute({
        start: request.start.point,
        end: corridor.endpoint,
        profile: "cycling"
      });

      let spine = primarySpine;
      if (!spine) {
        usedProfile = "walk_discovery";
        const backupAnchor = resolveTransportAnchor(corridor.endpoint);
        spine = await deps.fetchRoute({
          start: request.start.point,
          end: backupAnchor.point,
          profile: "walk_discovery"
        });
        if (!spine) {
          fallbackReason = "No live route spine could be fetched for this zone.";
        }
      }

      if (!spine) {
        return {
          candidates: [] as RouteCandidate[],
          status: {
            zoneId: corridor.id,
            zoneName: corridor.name,
            status: "unavailable",
            usedProfile,
            candidateCount: 0,
            reason: fallbackReason
          } satisfies ZoneDiscoveryStatus
        };
      }

      const sampled = sampleSpine(spine.geometry, spine.durationMinutes);
      const candidatePool = await Promise.all(
        sampled.map(async (sample) => {
          const nearby = await deps.getNearbyTransport(sample.point);
          const { anchor, eligible } = pickEndpointAnchor(sample.point, nearby);
          if (!eligible) {
            return null;
          }

          let routeGeometry = sample.geometry;
          let distanceKm = sample.distanceKm;
          let durationMinutes = sample.durationMinutes;
          let fromWalkingSpine = usedProfile === "walk_discovery";

          if (usedProfile === "walk_discovery") {
            const cyclingRoute = await deps.fetchRoute({
              start: request.start.point,
              end: sample.point,
              profile: "cycling"
            });

            if (!cyclingRoute) {
              return null;
            }

            routeGeometry = cyclingRoute.geometry;
            distanceKm = cyclingRoute.distanceKm;
            durationMinutes = cyclingRoute.durationMinutes;
            fromWalkingSpine = true;
          }

          const distanceToCentroid = haversineKm(sample.point, groupCentroid);
          const transportBias = anchor.kind === "rail" ? 0 : 0.25;
          const desirability = distanceToCentroid + anchor.distanceFromHomeKm * 0.7 + transportBias;

          const candidate: RouteCandidate = {
            id: `${corridor.id}-discovered-${sample.harvestedIndex}`,
            zoneId: corridor.id,
            zoneName: corridor.name,
            source: "discovered",
            profile: "cycling",
            routeName: "Live discovered route",
            endpointName: `${corridor.endpointName} corridor waypoint`,
            endpoint: sample.point,
            endpointAnchor: anchor,
            geometry: routeGeometry,
            distanceKm,
            cyclingMinutes: durationMinutes,
            routeQualityScore: null,
            routeQualitySource: "unknown" satisfies RouteQualitySource,
            overlapSignature: routeSignature(routeGeometry),
            discoveryDetails: {
              spineEndpointName: corridor.endpointName,
              harvestedIndex: sample.harvestedIndex,
              fromWalkingSpine
            }
          };

          return { candidate, desirability };
        })
      );

      const candidates = candidatePool
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((a, b) => a.desirability - b.desirability)
        .slice(0, 3)
        .map((item) => item.candidate);

      return {
        candidates,
        status: {
          zoneId: corridor.id,
          zoneName: corridor.name,
          status: candidates.length > 0 ? "available" : "partial",
          usedProfile,
          candidateCount: candidates.length,
          reason: zoneReason(usedProfile, candidates, fallbackReason)
        } satisfies ZoneDiscoveryStatus
      };
    })
  );

  const candidates: RouteCandidate[] = [];
  const zoneStatuses: ZoneDiscoveryStatus[] = [];

  for (const result of zoneResults) {
    if (result.status === "fulfilled") {
      candidates.push(...result.value.candidates);
      zoneStatuses.push(result.value.status);
    } else {
      zoneStatuses.push({
        zoneId: `zone-error-${zoneStatuses.length + 1}`,
        zoneName: "Unknown zone",
        status: "error",
        usedProfile: null,
        candidateCount: 0,
        reason: result.reason instanceof Error ? result.reason.message : "Discovery failed."
      });
    }
  }

  const successfulZones = zoneStatuses.filter((status) => status.status === "available").length;
  const liveDiscoveryStatus =
    successfulZones === 0 ? "unavailable" : successfulZones === zoneStatuses.length ? "available" : "partial";

  return {
    candidates,
    zoneStatuses,
    liveDiscoveryStatus
  };
}
