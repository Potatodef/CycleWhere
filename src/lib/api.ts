import { fallbackResolve } from "./geocodeFallback.js";
import { findRailStation, resolveRailStationAnchor } from "./anchors.js";
import { estimateTransitMinutes } from "./transit.js";
import type {
  GeocodeResponse,
  LocationResolution,
  ResolvedParticipant,
  RouteSearchError,
  RouteSearchPageResult,
  RouteSearchRequest,
  RouteSearchResult,
  TransitTimeQuery,
  TransitTimeResult,
  TransitTimesResponse
} from "../types.js";

const PRODUCTION_API_BASE = "https://cyclewhere-api-production.cyclewhere.workers.dev";
const API_REQUEST_TIMEOUT_MS = 10_000;
const API_REQUEST_MAX_ATTEMPTS = 3;
const API_RETRY_BASE_DELAY_MS = 250;

export function getApiBase() {
  const configured =
    (window as Window & {
      __CYCLEWHERE_CONFIG__?: { apiBase?: string };
    }).__CYCLEWHERE_CONFIG__?.apiBase ||
    (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE;
  const isLocalProxy =
    configured === "/proxy-api" && !["localhost", "127.0.0.1"].includes(window.location.hostname);

  return configured && !isLocalProxy ? configured : PRODUCTION_API_BASE;
}

function routeSearchError(message: string, code = "routing_unavailable", status?: number) {
  const error = new Error(message);
  Object.assign(error, { code, status });
  return error;
}

function isRetriableStatus(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function retryDelay(attempt: number) {
  return API_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = API_REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  const { signal, ...requestInit } = init;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortFromParent = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromParent, { once: true });
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    return await fetch(input, {
      ...requestInit,
      signal: controller.signal
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    signal?.removeEventListener("abort", abortFromParent);
  }
}

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit = {}) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= API_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init);
      if (isRetriableStatus(response.status) && attempt < API_REQUEST_MAX_ATTEMPTS) {
        await wait(retryDelay(attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt === API_REQUEST_MAX_ATTEMPTS) {
        throw error;
      }
      await wait(retryDelay(attempt));
    }
  }

  throw lastError;
}

async function routeJson<T>(response: Response) {
  try {
    return (await response.json()) as T | RouteSearchError;
  } catch {
    throw routeSearchError("Route search returned an unreadable response.", "routing_unavailable", response.status);
  }
}

function normalizeResolutionLabel(result: LocationResolution): LocationResolution {
  const label = result.label.trim();
  if (/^NIL\b/i.test(label)) {
    return {
      ...result,
      label: result.query.trim() || label.replace(/^NIL\b/i, "").trim() || label
    };
  }

  return result;
}

async function safeJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as T;
}

async function routeSearchResponse<T>(response: Response) {
  const payload = await routeJson<T>(response);
  if (!response.ok) {
    const routeError = payload as RouteSearchError;
    throw routeSearchError(routeError.error || "Route search failed.", routeError.code, response.status);
  }
  return payload as T;
}

export async function geocodeQueries(queries: string[]) {
  const apiBase = getApiBase();
  if (apiBase) {
    try {
      const response = await fetchWithRetry(`${apiBase}/api/geocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries })
      });
      const payload = await safeJson<GeocodeResponse>(response);
      if (payload?.results?.length === queries.length) {
        return payload.results.map(normalizeResolutionLabel);
      }
    } catch {
      // Fall back to local heuristics.
    }
  }

  return queries.map((query) => normalizeResolutionLabel(fallbackResolve(query)));
}

export async function fetchTransitTimes(queries: TransitTimeQuery[]) {
  const apiBase = getApiBase();
  if (apiBase) {
    try {
      const response = await fetchWithRetry(`${apiBase}/api/transit-times`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries })
      });
      const payload = await safeJson<TransitTimesResponse>(response);
      if (payload?.results?.length === queries.length) {
        return payload.results;
      }
    } catch {
      // Fall back to local heuristics.
    }
  }

  return queries.map<TransitTimeResult>((query) => ({
    minutes: estimateTransitMinutes(query),
    source: "estimate"
  }));
}

export async function createRouteSearch(request: RouteSearchRequest) {
  const apiBase = getApiBase();
  let response: Response;
  try {
    response = await fetchWithRetry(`${apiBase}/api/route-searches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
  } catch {
    throw routeSearchError(
      "The routing service could not be reached. Check your connection and try again.",
      "routing_network_error"
    );
  }
  return routeSearchResponse<RouteSearchResult>(response);
}

export async function loadRouteSearchPage(pageToken: string) {
  const apiBase = getApiBase();
  let response: Response;
  try {
    response = await fetchWithRetry(
      `${apiBase}/api/route-searches/page?token=${encodeURIComponent(pageToken)}`
    );
  } catch {
    throw routeSearchError(
      "The routing service could not be reached. Check your connection and try again.",
      "routing_network_error"
    );
  }
  return routeSearchResponse<RouteSearchPageResult>(response);
}

export async function resolveParticipants(
  drafts: Array<{ id: string; name: string; station: string }>
) {
  const needsGeocoding = drafts.map((draft) => !findRailStation(draft.station));
  const fallbackQueries = drafts
    .filter((_, index) => needsGeocoding[index])
    .map((draft) => draft.station);
  const fallbackResolutions = fallbackQueries.length ? await geocodeQueries(fallbackQueries) : [];
  let fallbackIndex = 0;

  return drafts.map((draft, index) => {
    const matchedStation = findRailStation(draft.station);
    const stationResolution = matchedStation
      ? ({
          query: draft.station,
          label: matchedStation.name,
          point: matchedStation.point,
          confidence: "high",
          source: "fallback"
        } satisfies LocationResolution)
      : ((fallbackResolutions[fallbackIndex++] as LocationResolution | undefined) ??
          fallbackResolve(draft.station));

    return {
      ...draft,
      stationResolution,
      anchor: resolveRailStationAnchor(draft.station, stationResolution)
    } satisfies ResolvedParticipant;
  });
}
