import type { LatLng, RoutingProfile } from "../../src/types.js";

type GraphHopperEnv = {
  GRAPHHOPPER_BASE_URL?: string;
  GRAPHHOPPER_API_KEY?: string;
  // Temporary compatibility for a misnamed secret in production.
  GRAPHOPPER_API_KEY?: string;
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

function graphHopperApiKey(env: GraphHopperEnv) {
  return env.GRAPHHOPPER_API_KEY ?? env.GRAPHOPPER_API_KEY;
}

function hostedApiEnabled(env: GraphHopperEnv) {
  return Boolean(graphHopperApiKey(env) && !env.GRAPHHOPPER_BASE_URL);
}

function routeProfile(env: GraphHopperEnv, profile: RoutingProfile) {
  if (hostedApiEnabled(env)) {
    // The hosted free tier offers a limited built-in vehicle set. Use the standard
    // bike profile instead of self-hosted custom profile names.
    return "bike";
  }

  const profiles: Record<string, string> = {
    official_protected: env.GRAPHHOPPER_PROFILE_OFFICIAL ?? "cyclewhere_official",
    official_quiet: env.GRAPHHOPPER_PROFILE_QUIET ?? "cyclewhere_quiet",
    bicycle: env.GRAPHHOPPER_PROFILE_BICYCLE ?? "cyclewhere_bicycle",
    cycling: env.GRAPHHOPPER_PROFILE_BICYCLE ?? "cyclewhere_bicycle"
  };
  return profiles[profile] ?? profiles.bicycle;
}

export async function snapMeetupWithGraphHopper(point: LatLng, env: GraphHopperEnv) {
  if (hostedApiEnabled(env)) {
    // The hosted routing API snaps request points internally during route calculation.
    // Keep the original point here instead of depending on a self-hosted /nearest endpoint.
    return {
      point,
      distanceMeters: 0
    };
  }
  if (!env.GRAPHHOPPER_BASE_URL) {
    throw new Error("GraphHopper is not configured.");
  }
  const base = env.GRAPHHOPPER_BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams({
    point: `${point.lat},${point.lng}`,
    profile: routeProfile(env, "bicycle")
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
  if (hostedApiEnabled(env)) {
    const apiKey = graphHopperApiKey(env);
    if (!apiKey) {
      throw new Error("GraphHopper hosted API key is not configured.");
    }
    const params = new URLSearchParams({
      key: apiKey,
      profile: routeProfile(env, input.profile),
      points_encoded: "false",
      instructions: "false",
      elevation: "false"
    });
    params.append("point", `${input.start.lat},${input.start.lng}`);
    params.append("point", `${input.end.lat},${input.end.lng}`);

    const response = await fetch(`https://graphhopper.com/api/1/route?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`GraphHopper hosted route failed with ${response.status}.`);
    }
    const payload = (await response.json()) as GraphHopperResponse;
    const path = payload.paths?.[0];
    if (!path?.points.coordinates?.length) {
      return null;
    }
    const graphEdgeIds = path.details?.edge_id?.map((detail) => String(detail[2])) ?? [];
    return {
      geometry: path.points.coordinates.map(([lng, lat]) => ({ lat, lng })),
      graphEdgeIds: graphEdgeIds.length ? graphEdgeIds : undefined,
      distanceKm: path.distance / 1000,
      durationMinutes: Math.max(1, Math.round(path.time / 60000))
    };
  }

  if (!env.GRAPHHOPPER_BASE_URL) {
    throw new Error("GraphHopper is not configured.");
  }
  const response = await fetch(`${env.GRAPHHOPPER_BASE_URL.replace(/\/$/, "")}/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.GRAPHHOPPER_BEARER_TOKEN
        ? { Authorization: `Bearer ${env.GRAPHHOPPER_BEARER_TOKEN}` }
        : {})
    },
    body: JSON.stringify({
      profile: routeProfile(env, input.profile),
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
