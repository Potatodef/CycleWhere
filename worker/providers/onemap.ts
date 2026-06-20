import { decodePolyline } from "../../src/lib/polyline.js";
import type {
  GeocodeResponse,
  LatLng,
  LocationResolution,
  TransitTimeQuery,
  TransitTimeResult,
  TransportAnchor
} from "../../src/types.js";

type OneMapEnv = {
  ONEMAP_API_EMAIL?: string;
  ONEMAP_API_PASSWORD?: string;
  ONEMAP_BASE_URL?: string;
};

type OneMapSearchResult = {
  SEARCHVAL?: string;
  BLK_NO?: string;
  ROAD_NAME?: string;
  BUILDING?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
};

type NearbyStop = {
  id?: string | number;
  name?: string;
  lat?: number;
  lon?: number;
  road?: string;
};

type RouteProfile = "cycling" | "walk_discovery";

let accessTokenCache:
  | {
      token: string;
      expiresAt: number;
    }
  | null = null;

function baseUrl(env: OneMapEnv) {
  return env.ONEMAP_BASE_URL || "https://www.onemap.gov.sg";
}

function toLabel(result: OneMapSearchResult, query: string) {
  const structured = [result.BLK_NO, result.ROAD_NAME, result.BUILDING].filter(Boolean).join(" ").trim();
  if (structured) {
    return structured;
  }

  const searchValue = result.SEARCHVAL?.trim();
  if (!searchValue || /^NIL\b/i.test(searchValue)) {
    return query;
  }

  return searchValue;
}

function requireCredentials(env: OneMapEnv) {
  if (!env.ONEMAP_API_EMAIL || !env.ONEMAP_API_PASSWORD) {
    throw new Error("OneMap credentials are not configured");
  }
}

async function getAccessToken(env: OneMapEnv) {
  requireCredentials(env);

  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return accessTokenCache.token;
  }

  const response = await fetch(`${baseUrl(env)}/api/auth/post/getToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: env.ONEMAP_API_EMAIL,
      password: env.ONEMAP_API_PASSWORD
    })
  });

  if (!response.ok) {
    throw new Error(`Unable to retrieve OneMap token (${response.status})`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
  };

  if (!payload.access_token) {
    throw new Error("OneMap token response did not include access_token");
  }

  accessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + 71 * 60 * 60 * 1000
  };

  return payload.access_token;
}

async function fetchWithAuth(url: string, env: OneMapEnv) {
  const token = await getAccessToken(env);
  let response = await fetch(url, {
    headers: {
      Authorization: token
    }
  });

  if (response.status === 401) {
    accessTokenCache = null;
    const refreshed = await getAccessToken(env);
    response = await fetch(url, {
      headers: {
        Authorization: refreshed
      }
    });
  }

  return response;
}

function extractBestDurationMinutes(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const anyPayload = payload as Record<string, unknown>;
  const candidateValues = [
    anyPayload.total_time,
    anyPayload.duration,
    anyPayload.travelTime,
    (anyPayload.route_summary as Record<string, unknown> | undefined)?.total_time,
    (anyPayload.route_summary as Record<string, unknown> | undefined)?.total_time_in_min,
    Array.isArray(anyPayload.plan)
      ? null
      : (anyPayload.plan as Record<string, unknown> | undefined)?.itineraries
  ];

  for (const candidate of candidateValues) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return normalizeDurationMinutes(candidate);
    }
    if (typeof candidate === "string") {
      const parsed = Number.parseFloat(candidate);
      if (Number.isFinite(parsed)) {
        return normalizeDurationMinutes(parsed);
      }
    }
  }

  const itineraries = (anyPayload.plan as Record<string, unknown> | undefined)?.itineraries;
  if (Array.isArray(itineraries)) {
    const durations = itineraries
      .map((itinerary) => (itinerary as Record<string, unknown>).duration)
      .map((value) => (typeof value === "string" ? Number.parseFloat(value) : value))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .map((value) => normalizeDurationMinutes(value))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (durations.length > 0) {
      return Math.min(...durations);
    }
  }

  return null;
}

function normalizeDurationMinutes(rawDuration: number) {
  if (!Number.isFinite(rawDuration)) {
    return null;
  }

  // OneMap routing payloads commonly return duration-like fields in seconds.
  return rawDuration > 240 ? Math.round(rawDuration / 60) : Math.round(rawDuration);
}

function toSingaporeDateTime(isoString: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(new Date(isoString));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${value("month")}-${value("day")}-${value("year")}`,
    time: `${value("hour")}:${value("minute")}:00`
  };
}

export async function geocodeWithOneMap(query: string, env: OneMapEnv): Promise<LocationResolution> {
  const url = new URL(`${baseUrl(env)}/api/common/elastic/search`);
  url.searchParams.set("searchVal", query);
  url.searchParams.set("returnGeom", "Y");
  url.searchParams.set("getAddrDetails", "Y");
  url.searchParams.set("pageNum", "1");

  const response = await fetchWithAuth(url.toString(), env);
  const payload = (await response.json()) as {
    found?: number;
    results?: OneMapSearchResult[];
    error?: string;
  };

  if (payload.error) {
    throw new Error(payload.error);
  }

  const match = payload.results?.[0];
  if (!match?.LATITUDE || !match?.LONGITUDE) {
    throw new Error(`No OneMap geocode result for "${query}"`);
  }

  return {
    query,
    label: toLabel(match, query),
    point: {
      lat: Number.parseFloat(match.LATITUDE),
      lng: Number.parseFloat(match.LONGITUDE)
    },
    confidence: payload.found && payload.found > 0 ? "high" : "medium",
    source: "onemap"
  };
}

export async function geocodeManyWithOneMap(
  queries: string[],
  env: OneMapEnv
): Promise<GeocodeResponse> {
  const results = await Promise.all(queries.map((query) => geocodeWithOneMap(query, env)));
  return { results };
}

export async function fetchTransitTimeWithOneMap(
  query: TransitTimeQuery,
  env: OneMapEnv
): Promise<TransitTimeResult> {
  const { date, time } = toSingaporeDateTime(query.departureIso);

  const url = new URL(`${baseUrl(env)}/api/public/routingsvc/route`);
  url.searchParams.set("start", `${query.from.lat},${query.from.lng}`);
  url.searchParams.set("end", `${query.to.lat},${query.to.lng}`);
  url.searchParams.set("routeType", "pt");
  url.searchParams.set("date", date);
  url.searchParams.set("time", time);
  url.searchParams.set("mode", "transit");
  url.searchParams.set("maxWalkDistance", "1200");
  url.searchParams.set("numItineraries", "3");

  const response = await fetchWithAuth(url.toString(), env);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OneMap transit request failed (${response.status}): ${errorBody.slice(0, 400)}`
    );
  }
  const payload = await response.json();
  const minutes = extractBestDurationMinutes(payload);
  if (minutes === null) {
    throw new Error(
      `OneMap transit payload was unparseable: ${JSON.stringify(payload).slice(0, 400)}`
    );
  }

  return {
    minutes,
    source: "onemap"
  };
}

export async function fetchRouteWithOneMap(
  {
    start,
    end,
    profile
  }: {
    start: LatLng;
    end: LatLng;
    profile: RouteProfile;
  },
  env: OneMapEnv
) {
  const routeType = profile === "cycling" ? "cycle" : "walk";
  const url = new URL(`${baseUrl(env)}/api/public/routingsvc/route`);
  url.searchParams.set("start", `${start.lat},${start.lng}`);
  url.searchParams.set("end", `${end.lat},${end.lng}`);
  url.searchParams.set("routeType", routeType);

  const response = await fetchWithAuth(url.toString(), env);
  if (!response.ok) {
    throw new Error(`OneMap route request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    route_geometry?: string;
    route_summary?: {
      total_time?: number;
      total_distance?: number;
    };
    status?: number | string;
    status_message?: string;
  };

  const statusValue =
    typeof payload.status === "string" ? Number.parseInt(payload.status, 10) : payload.status;

  if (!payload.route_geometry) {
    return null;
  }

  if (typeof statusValue === "number" && statusValue !== 0) {
    return null;
  }

  return {
    geometry: decodePolyline(payload.route_geometry),
    distanceKm: Math.round(((payload.route_summary?.total_distance ?? 0) / 1000) * 10) / 10,
    durationMinutes: normalizeDurationMinutes(payload.route_summary?.total_time ?? 0) ?? 0
  };
}

function normalizeNearbyStop(stop: NearbyStop, kind: "rail" | "bus", point: LatLng): TransportAnchor {
  const stopPoint = {
    lat: stop.lat ?? point.lat,
    lng: stop.lon ?? point.lng
  };
  const distanceFromHomeKm =
    Math.round(
      Math.hypot(stopPoint.lat - point.lat, stopPoint.lng - point.lng) * 111 * 10
    ) / 10;

  return {
    id: `${kind}-${stop.id ?? stop.name ?? "anchor"}`,
    name: stop.name || `${kind === "rail" ? "Rail" : "Bus"} stop`,
    kind,
    point: stopPoint,
    distanceFromHomeKm,
    fallbackSuggested: false
  };
}

export async function getNearbyTransportWithOneMap(point: LatLng, env: OneMapEnv) {
  const railUrl = new URL(`${baseUrl(env)}/api/public/nearbysvc/getNearestMrtStops`);
  railUrl.searchParams.set("latitude", `${point.lat}`);
  railUrl.searchParams.set("longitude", `${point.lng}`);
  railUrl.searchParams.set("radius_in_meters", "1000");

  const busUrl = new URL(`${baseUrl(env)}/api/public/nearbysvc/getNearestBusStops`);
  busUrl.searchParams.set("latitude", `${point.lat}`);
  busUrl.searchParams.set("longitude", `${point.lng}`);
  busUrl.searchParams.set("radius_in_meters", "400");

  const [railResponse, busResponse] = await Promise.all([
    fetchWithAuth(railUrl.toString(), env),
    fetchWithAuth(busUrl.toString(), env)
  ]);
  const [railPayload, busPayload] = (await Promise.all([
    railResponse.json(),
    busResponse.json()
  ])) as [NearbyStop[] | { error?: string }, NearbyStop[] | { error?: string }];

  const rails = Array.isArray(railPayload)
    ? railPayload.map((stop) => normalizeNearbyStop(stop, "rail", point))
    : [];
  const buses = Array.isArray(busPayload)
    ? busPayload.map((stop) => normalizeNearbyStop(stop, "bus", point))
    : [];

  return {
    rails,
    buses
  };
}
