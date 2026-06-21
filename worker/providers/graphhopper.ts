import type { LatLng, RoutingProfile } from "../../src/types.js";

type GraphHopperEnv = {
  GRAPHHOPPER_BASE_URL?: string;
  GRAPHHOPPER_BEARER_TOKEN?: string;
  GRAPHHOPPER_PROFILE_OFFICIAL?: string;
  GRAPHHOPPER_PROFILE_QUIET?: string;
  GRAPHHOPPER_PROFILE_BICYCLE?: string;
};

type GraphHopperPath = {
  distance: number;
  time: number;
  points: { coordinates: Array<[number, number]> };
  details?: { edge_id?: Array<[number, number, string | number]> };
};

type GraphHopperResponse = {
  paths?: GraphHopperPath[];
  message?: string;
};

type GraphHopperNearestResponse = {
  coordinates?: [number, number];
  distance?: number;
};

export async function snapMeetupWithGraphHopper(point: LatLng, env: GraphHopperEnv) {
  if (!env.GRAPHHOPPER_BASE_URL) {
    throw new Error("GraphHopper is not configured.");
  }
  const base = env.GRAPHHOPPER_BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams({
    point: `${point.lat},${point.lng}`,
    profile: env.GRAPHHOPPER_PROFILE_BICYCLE ?? "cyclewhere_bicycle"
  });
  const response = await fetch(`${base}/nearest?${params}`, {
    headers: env.GRAPHHOPPER_BEARER_TOKEN
      ? { Authorization: `Bearer ${env.GRAPHHOPPER_BEARER_TOKEN}` }
      : undefined
  });
  if (!response.ok) {
    throw new Error(`GraphHopper nearest-edge lookup failed with ${response.status}.`);
  }
  const result = (await response.json()) as GraphHopperNearestResponse;
  if (!result.coordinates || typeof result.distance !== "number" || result.distance > 75) {
    return null;
  }
  return {
    point: { lat: result.coordinates[1], lng: result.coordinates[0] },
    distanceMeters: result.distance
  };
}

export async function fetchRouteWithGraphHopper(
  input: { start: LatLng; end: LatLng; profile: RoutingProfile },
  env: GraphHopperEnv
) {
  if (!env.GRAPHHOPPER_BASE_URL) {
    throw new Error("GraphHopper is not configured.");
  }
  const profiles: Record<string, string> = {
    official_protected: env.GRAPHHOPPER_PROFILE_OFFICIAL ?? "cyclewhere_official",
    official_quiet: env.GRAPHHOPPER_PROFILE_QUIET ?? "cyclewhere_quiet",
    bicycle: env.GRAPHHOPPER_PROFILE_BICYCLE ?? "cyclewhere_bicycle",
    cycling: env.GRAPHHOPPER_PROFILE_BICYCLE ?? "cyclewhere_bicycle"
  };
  const response = await fetch(`${env.GRAPHHOPPER_BASE_URL.replace(/\/$/, "")}/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.GRAPHHOPPER_BEARER_TOKEN
        ? { Authorization: `Bearer ${env.GRAPHHOPPER_BEARER_TOKEN}` }
        : {})
    },
    body: JSON.stringify({
      profile: profiles[input.profile] ?? profiles.bicycle,
      points: [
        [input.start.lng, input.start.lat],
        [input.end.lng, input.end.lat]
      ],
      points_encoded: false,
      instructions: false,
      elevation: false,
      details: ["edge_id"]
    })
  });
  if (!response.ok) {
    throw new Error(`GraphHopper route failed with ${response.status}.`);
  }
  const payload = (await response.json()) as GraphHopperResponse;
  const path = payload.paths?.[0];
  if (!path?.points.coordinates?.length) {
    return null;
  }
  const graphEdgeIds = path.details?.edge_id?.map((detail) => String(detail[2])) ?? [];
  if (graphEdgeIds.length === 0) {
    throw new Error("GraphHopper route did not include edge provenance.");
  }
  return {
    geometry: path.points.coordinates.map(([lng, lat]) => ({ lat, lng })),
    graphEdgeIds,
    distanceKm: path.distance / 1000,
    durationMinutes: Math.max(1, Math.round(path.time / 60000))
  };
}
