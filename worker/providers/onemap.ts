import type {
  GeocodeResponse,
  LocationResolution,
  TransitTimeQuery,
  TransitTimeResult
} from "../../src/types.js";

type OneMapSearchResult = {
  SEARCHVAL?: string;
  BLK_NO?: string;
  ROAD_NAME?: string;
  BUILDING?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
};

function toLabel(result: OneMapSearchResult) {
  return (
    [result.BLK_NO, result.ROAD_NAME, result.BUILDING]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    result.SEARCHVAL ||
    "Matched address"
  );
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
      return Math.round(candidate);
    }
  }

  const itineraries = (anyPayload.plan as Record<string, unknown> | undefined)?.itineraries;
  if (Array.isArray(itineraries)) {
    const durations = itineraries
      .map((itinerary) => (itinerary as Record<string, unknown>).duration)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .map((value) => Math.round(value / 60));
    if (durations.length > 0) {
      return Math.min(...durations);
    }
  }

  return null;
}

export async function geocodeWithOneMap(query: string): Promise<LocationResolution> {
  const url = new URL("https://www.onemap.gov.sg/api/common/elastic/search");
  url.searchParams.set("searchVal", query);
  url.searchParams.set("returnGeom", "Y");
  url.searchParams.set("getAddrDetails", "Y");
  url.searchParams.set("pageNum", "1");

  const response = await fetch(url.toString());
  const payload = (await response.json()) as {
    found?: number;
    results?: OneMapSearchResult[];
  };

  const match = payload.results?.[0];
  if (!match?.LATITUDE || !match?.LONGITUDE) {
    throw new Error(`No OneMap geocode result for "${query}"`);
  }

  return {
    query,
    label: toLabel(match),
    point: {
      lat: Number.parseFloat(match.LATITUDE),
      lng: Number.parseFloat(match.LONGITUDE)
    },
    confidence: payload.found && payload.found > 0 ? "high" : "medium",
    source: "onemap"
  };
}

export async function geocodeManyWithOneMap(queries: string[]): Promise<GeocodeResponse> {
  const results = await Promise.all(queries.map((query) => geocodeWithOneMap(query)));
  return { results };
}

export async function fetchTransitTimeWithOneMap(
  query: TransitTimeQuery
): Promise<TransitTimeResult> {
  const departure = new Date(query.departureIso);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  const date = `${pad(departure.getDate())}-${pad(departure.getMonth() + 1)}-${departure.getFullYear()}`;
  const time = `${pad(departure.getHours())}:${pad(departure.getMinutes())}:00`;

  const url = new URL("https://www.onemap.gov.sg/api/public/routingsvc/route");
  url.searchParams.set("start", `${query.from.lat},${query.from.lng}`);
  url.searchParams.set("end", `${query.to.lat},${query.to.lng}`);
  url.searchParams.set("routeType", "pt");
  url.searchParams.set("date", date);
  url.searchParams.set("time", time);
  url.searchParams.set("mode", "TRANSIT");
  url.searchParams.set("maxWalkDistance", "1200");

  const response = await fetch(url.toString());
  const payload = await response.json();
  const minutes = extractBestDurationMinutes(payload);

  return {
    minutes,
    source: "onemap"
  };
}
