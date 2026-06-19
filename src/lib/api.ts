import { fallbackResolve } from "./geocodeFallback.js";
import { resolveTransportAnchor } from "./anchors.js";
import { estimateTransitMinutes } from "./transit.js";
import type {
  DiscoverRoutesRequest,
  DiscoveredRoutesResponse,
  GeocodeResponse,
  LocationResolution,
  ResolvedParticipant,
  TransitTimeQuery,
  TransitTimeResult,
  TransitTimesResponse
} from "../types.js";

const apiBase =
  (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ??
  (window as Window & {
    __CYCLEWHERE_CONFIG__?: { apiBase?: string };
  }).__CYCLEWHERE_CONFIG__?.apiBase ??
  "";

async function safeJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as T;
}

export async function geocodeQueries(queries: string[]) {
  if (apiBase) {
    try {
      const response = await fetch(`${apiBase}/api/geocode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries })
      });
      const payload = await safeJson<GeocodeResponse>(response);
      if (payload?.results?.length === queries.length) {
        return payload.results;
      }
    } catch {
      // Fall back to local heuristics.
    }
  }

  return queries.map((query) => fallbackResolve(query));
}

export async function fetchTransitTimes(queries: TransitTimeQuery[]) {
  if (apiBase) {
    try {
      const response = await fetch(`${apiBase}/api/transit-times`, {
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

export async function discoverCyclingRoutes(request: DiscoverRoutesRequest) {
  if (!apiBase) {
    return {
      candidates: [],
      zoneStatuses: [],
      liveDiscoveryStatus: "unavailable"
    } satisfies DiscoveredRoutesResponse;
  }

  try {
    const response = await fetch(`${apiBase}/api/discover-cycling-routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    const payload = await safeJson<DiscoveredRoutesResponse>(response);
    if (payload) {
      return payload;
    }
  } catch {
    // Fall back to curated-only planning.
  }

  return {
    candidates: [],
    zoneStatuses: [],
    liveDiscoveryStatus: "unavailable"
  } satisfies DiscoveredRoutesResponse;
}

export async function resolveParticipants(
  drafts: Array<{ id: string; name: string; address: string }>
) {
  const homes = await geocodeQueries(drafts.map((draft) => draft.address));

  return drafts.map((draft, index) => {
    const home = homes[index] as LocationResolution;
    return {
      ...draft,
      home,
      anchor: resolveTransportAnchor(home.point)
    } satisfies ResolvedParticipant;
  });
}
