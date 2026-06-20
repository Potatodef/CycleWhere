import { fallbackResolve } from "./geocodeFallback.js";
import { findRailStation, resolveRailStationAnchor } from "./anchors.js";
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
        return payload.results.map(normalizeResolutionLabel);
      }
    } catch {
      // Fall back to local heuristics.
    }
  }

  return queries.map((query) => normalizeResolutionLabel(fallbackResolve(query)));
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
      curatedCandidates: [],
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
      return {
        ...payload,
        curatedCandidates: payload.curatedCandidates ?? []
      };
    }
  } catch {
    // Fall back to curated-only planning.
  }

  return {
    candidates: [],
    curatedCandidates: [],
    zoneStatuses: [],
    liveDiscoveryStatus: "unavailable"
  } satisfies DiscoveredRoutesResponse;
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
