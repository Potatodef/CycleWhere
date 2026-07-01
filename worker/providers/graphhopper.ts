import type { LatLng, RoutingProfile } from "../../src/types.js";

type GraphHopperEnv = {
  GRAPHHOPPER_BASE_URL?: string;
  GRAPHHOPPER_API_KEY?: string;
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

type NormalizedGraphHopperRoute = {
  geometry: LatLng[];
  graphEdgeIds?: string[];
  distanceKm: number;
  durationMinutes: number;
};

export type GraphHopperProviderMode = "hosted" | "self-hosted" | "unconfigured";

export class GraphHopperSystemicError extends Error {
  readonly routingFailureKind = "systemic";
  readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "GraphHopperSystemicError";
    this.status = options.status;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function graphHopperApiKey(env: GraphHopperEnv) {
  return env.GRAPHHOPPER_API_KEY;
}

export function graphHopperProviderMode(env: GraphHopperEnv | undefined): GraphHopperProviderMode {
  if (env?.GRAPHHOPPER_BASE_URL) {
    return "self-hosted";
  }
  if (env?.GRAPHHOPPER_API_KEY) {
    return "hosted";
  }
  return "unconfigured";
}

function hostedApiEnabled(env: GraphHopperEnv) {
  return graphHopperProviderMode(env) === "hosted";
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

function isFiniteCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function normalizeGraphHopperPath(
  path: GraphHopperPath | undefined,
  { requireEdgeIds }: { requireEdgeIds: boolean }
): NormalizedGraphHopperRoute | null {
  if (!path?.points.coordinates?.length) {
    return null;
  }
  if (!Number.isFinite(path.distance) || path.distance <= 0 || !Number.isFinite(path.time) || path.time < 0) {
    return null;
  }
  if (!path.points.coordinates.every(isFiniteCoordinatePair)) {
    return null;
  }

  const graphEdgeIds = path.details?.edge_id?.map((detail) => String(detail[2])) ?? [];
  if (requireEdgeIds && graphEdgeIds.length === 0) {
    throw new GraphHopperSystemicError("GraphHopper route did not include edge provenance.");
  }

  return {
    geometry: path.points.coordinates.map(([lng, lat]) => ({ lat, lng })),
    graphEdgeIds: graphEdgeIds.length ? graphEdgeIds : undefined,
    distanceKm: path.distance / 1000,
    durationMinutes: Math.max(1, Math.round(path.time / 60000))
  };
}

async function fetchGraphHopper(input: string | URL | Request, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new GraphHopperSystemicError("GraphHopper request failed before receiving a response.", {
      cause: error
    });
  }
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
  const response = await fetchGraphHopper(`${base}/nearest?${params}`, {
    headers: env.GRAPHHOPPER_BEARER_TOKEN
      ? { Authorization: `Bearer ${env.GRAPHHOPPER_BEARER_TOKEN}` }
      : undefined
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      return null;
    }
    throw new GraphHopperSystemicError(
      `GraphHopper nearest-edge lookup failed with ${response.status}.`,
      { status: response.status }
    );
  }
  const result = (await response.json()) as GraphHopperNearestResponse;
  if (
    !isFiniteCoordinatePair(result.coordinates) ||
    typeof result.distance !== "number" ||
    !Number.isFinite(result.distance) ||
    result.distance > 75
  ) {
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

    const response = await fetchGraphHopper(`https://graphhopper.com/api/1/route?${params.toString()}`);
    if (!response.ok) {
      if (response.status === 400 || response.status === 404) {
        return null;
      }
      throw new GraphHopperSystemicError(`GraphHopper hosted route failed with ${response.status}.`, {
        status: response.status
      });
    }
    const payload = (await response.json()) as GraphHopperResponse;
    return normalizeGraphHopperPath(payload.paths?.[0], { requireEdgeIds: false });
  }

  if (!env.GRAPHHOPPER_BASE_URL) {
    throw new GraphHopperSystemicError("GraphHopper is not configured.");
  }
  const response = await fetchGraphHopper(`${env.GRAPHHOPPER_BASE_URL.replace(/\/$/, "")}/route`, {
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
    if (response.status === 400 || response.status === 404) {
      return null;
    }
    throw new GraphHopperSystemicError(`GraphHopper route failed with ${response.status}.`, {
      status: response.status
    });
  }
  const payload = (await response.json()) as GraphHopperResponse;
  return normalizeGraphHopperPath(payload.paths?.[0], { requireEdgeIds: true });
}
