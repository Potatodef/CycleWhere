import { Hono } from "hono";
import { cors } from "hono/cors";
import networkManifest from "../public/data/network-manifest.json";
import { fallbackResolve } from "../src/lib/geocodeFallback.js";
import { planRoutes } from "../src/lib/planner.js";
import { estimateTransitMinutes } from "../src/lib/transit.js";
import type {
  GeocodeResponse,
  ResolvedParticipant,
  RouteSearchError,
  RouteSearchRequest,
  RouteSearchResult,
  TransitTimeQuery,
  TransitTimesResponse
} from "../src/types.js";
import { discoverCyclingRoutes } from "./discovery.js";
import { fetchRouteWithGraphHopper, snapMeetupWithGraphHopper } from "./providers/graphhopper.js";
import {
  hashRequest,
  loadRouteSearch,
  materializePage,
  newSearchExpiry,
  readPageToken,
  storeRouteSearch
} from "./sessions.js";
import {
  fetchTransitTimeWithOneMap,
  geocodeManyWithOneMap
} from "./providers/onemap.js";

type Bindings = {
  TRANSIT_CACHE?: D1Database;
  CORS_ORIGIN?: string;
  ONEMAP_API_EMAIL?: string;
  ONEMAP_API_PASSWORD?: string;
  ONEMAP_BASE_URL?: string;
  GRAPHHOPPER_BASE_URL?: string;
  GRAPHHOPPER_API_KEY?: string;
  // Temporary compatibility for a misnamed secret in production.
  GRAPHOPPER_API_KEY?: string;
  GRAPHHOPPER_BEARER_TOKEN?: string;
  GRAPHHOPPER_PROFILE_OFFICIAL?: string;
  GRAPHHOPPER_PROFILE_QUIET?: string;
  GRAPHHOPPER_PROFILE_BICYCLE?: string;
  GRAPH_VERSION?: string;
  PROFILE_HASH?: string;
  OVERLAY_HASH?: string;
  RANKING_HASH?: string;
  PAGE_TOKEN_SECRET?: string;
};

export const app = new Hono<{ Bindings: Bindings }>();
const MAX_GEOCODE_QUERIES = 12;
const MAX_TRANSIT_QUERIES = 40;
const MAX_PARTICIPANTS = 10;

function hasRoutingProvider(env: Bindings | undefined) {
  return Boolean(env?.GRAPHHOPPER_BASE_URL || env?.GRAPHHOPPER_API_KEY || env?.GRAPHOPPER_API_KEY);
}

function resolveCorsOrigin(origin: string | undefined, configuredOrigins: string | undefined) {
  const allowlist = configuredOrigins
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!allowlist?.length) {
    return origin || "*";
  }

  if (!origin) {
    return allowlist[0];
  }

  if (allowlist.includes("*") || allowlist.includes(origin)) {
    return origin;
  }

  return allowlist[0];
}

app.use(
  "*",
  cors({
    origin: (origin, context) => resolveCorsOrigin(origin, context.env?.CORS_ORIGIN),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"]
  })
);

async function getCachedTransit(
  database: D1Database | undefined,
  key: string
): Promise<number | null> {
  if (!database) {
    return null;
  }
  const row = await database
    .prepare("SELECT minutes FROM transit_cache WHERE cache_key = ?")
    .bind(key)
    .first<{ minutes: number }>();
  return row?.minutes ?? null;
}

async function setCachedTransit(
  database: D1Database | undefined,
  key: string,
  minutes: number
) {
  if (!database) {
    return;
  }
  await database
    .prepare(
      "INSERT OR REPLACE INTO transit_cache (cache_key, minutes, updated_at) VALUES (?, ?, ?)"
    )
    .bind(key, minutes, new Date().toISOString())
    .run();
}

async function getCachedJson(
  database: D1Database | undefined,
  tableName: "route_cache",
  key: string
) {
  if (!database) {
    return null;
  }

  const row = await database
    .prepare(`SELECT payload FROM ${tableName} WHERE cache_key = ?`)
    .bind(key)
    .first<{ payload: string }>();

  return row?.payload ? JSON.parse(row.payload) : null;
}

async function setCachedJson(
  database: D1Database | undefined,
  tableName: "route_cache",
  key: string,
  payload: unknown
) {
  if (!database) {
    return;
  }

  await database
    .prepare(
      `INSERT OR REPLACE INTO ${tableName} (cache_key, payload, updated_at) VALUES (?, ?, ?)`
    )
    .bind(key, JSON.stringify(payload), new Date().toISOString())
    .run();
}

function roundedKey(point: { lat: number; lng: number }) {
  return `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
}

function transitCacheKey(query: TransitTimeQuery) {
  return [
    roundedKey(query.from),
    roundedKey(query.to),
    query.departureIso,
    query.modeHint
  ].join("|");
}

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    service: "cyclewhere-api",
    routingConfigured: hasRoutingProvider(context.env),
    graphVersion: context.env?.GRAPH_VERSION ?? networkManifest.version,
    profileHash: context.env?.PROFILE_HASH ?? null,
    overlayHash: context.env?.OVERLAY_HASH ?? null,
    rankingHash: context.env?.RANKING_HASH ?? null,
    timestamp: new Date().toISOString()
  })
);

app.get("/api/network-manifest", (context) => context.json(networkManifest));

app.post("/api/geocode", async (context) => {
  const payload = (await context.req.json()) as { queries?: string[] };
  const queries = payload.queries?.filter(Boolean) ?? [];

  if (queries.length === 0) {
    return context.json<GeocodeResponse>({ results: [] });
  }
  if (queries.length > MAX_GEOCODE_QUERIES) {
    return context.json({ error: "Too many geocode queries." }, 400);
  }

  try {
    return context.json(await geocodeManyWithOneMap(queries, context.env));
  } catch {
    return context.json<GeocodeResponse>({
      results: queries.map((query) => fallbackResolve(query))
    });
  }
});

app.post("/api/transit-times", async (context) => {
  const payload = (await context.req.json()) as { queries?: TransitTimeQuery[] };
  const queries = payload.queries ?? [];
  if (queries.length > MAX_TRANSIT_QUERIES) {
    return context.json({ error: "Too many transit queries." }, 400);
  }
  const results = await Promise.all(
    queries.map(async (query) => {
      const cacheKey = transitCacheKey(query);
      const cached = await getCachedTransit(context.env.TRANSIT_CACHE, cacheKey);
      if (cached !== null) {
        return { minutes: cached, source: "onemap" as const };
      }

      try {
        const result = await fetchTransitTimeWithOneMap(query, context.env);
        if (typeof result.minutes === "number") {
          await setCachedTransit(context.env.TRANSIT_CACHE, cacheKey, result.minutes);
          return result;
        }
      } catch (error) {
        console.error("Transit lookup failed", {
          from: query.from,
          to: query.to,
          modeHint: query.modeHint,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      return {
        minutes: estimateTransitMinutes(query),
        source: "estimate" as const
      };
    })
  );

  return context.json<TransitTimesResponse>({ results });
});

function validSingaporePoint(point: { lat: number; lng: number } | undefined) {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      point.lat >= 1.13 &&
      point.lat <= 1.49 &&
      point.lng >= 103.58 &&
      point.lng <= 104.1
  );
}

app.post("/api/route-searches", async (context) => {
  const payload = (await context.req.json()) as RouteSearchRequest;
  if (!payload.start?.point || !Array.isArray(payload.participants)) {
    return context.json<RouteSearchError>(
      { error: "Invalid route-search request.", code: "invalid_meetup" },
      422
    );
  }
  if (payload.participants.length === 0 || payload.participants.length > MAX_PARTICIPANTS) {
    return context.json({ error: "Invalid participant count." }, 400);
  }
  if (!validSingaporePoint(payload.start.point)) {
    return context.json<RouteSearchError>(
      { error: "Meetup is outside the supported Singapore service area.", code: "invalid_meetup" },
      422
    );
  }
  if (!context.env.TRANSIT_CACHE || !context.env.PAGE_TOKEN_SECRET) {
    return context.json<RouteSearchError>(
      { error: "Route-search sessions are not configured.", code: "routing_unavailable" },
      503
    );
  }
  if (!hasRoutingProvider(context.env)) {
    return context.json<RouteSearchError>(
      { error: "The routing graph is not available.", code: "routing_unavailable" },
      503
    );
  }

  try {
    const snappedStart = await snapMeetupWithGraphHopper(payload.start.point, context.env);
    if (!snappedStart) {
      return context.json<RouteSearchError>(
        { error: "Meetup cannot safely snap to the bicycle network.", code: "invalid_meetup" },
        422
      );
    }
    const normalizedPayload = {
      ...payload,
      start: { ...payload.start, point: snappedStart.point }
    };
    const result = await discoverCyclingRoutes(normalizedPayload, {
      routingProfiles: context.env.GRAPHHOPPER_API_KEY || context.env.GRAPHOPPER_API_KEY ? ["bicycle"] : undefined,
      maxDiscoveryEndpoints: context.env.GRAPHHOPPER_API_KEY || context.env.GRAPHOPPER_API_KEY ? 6 : undefined,
      maxFallbackEndpoints: context.env.GRAPHHOPPER_API_KEY || context.env.GRAPHOPPER_API_KEY ? 4 : undefined,
      fetchRoute: async ({ start, end, profile }) => {
        const cacheKey = JSON.stringify({
          version: 4,
          graphVersion: context.env.GRAPH_VERSION ?? networkManifest.version,
          profile,
          start: roundedKey(start),
          end: roundedKey(end)
        });
        let cached = null;
        try {
          cached = await getCachedJson(context.env.TRANSIT_CACHE, "route_cache", cacheKey);
        } catch (error) {
          console.error("Route cache read failed", error);
        }
        if (cached) {
          return cached;
        }

        const route = await fetchRouteWithGraphHopper({ start, end, profile }, context.env);
        if (route) {
          try {
            await setCachedJson(context.env.TRANSIT_CACHE, "route_cache", cacheKey, route);
          } catch (error) {
            console.error("Route cache write failed", error);
          }
        }
        return route;
      }
    });

    const searchId = crypto.randomUUID();
    const expiresAt = newSearchExpiry();
    const resolvedParticipants = normalizedPayload.participants.map(
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
    );
    const estimatedOrder = planRoutes({
      candidates: result.routes,
      participants: resolvedParticipants,
      startTimeIso: normalizedPayload.departureIso,
      zoneStatuses: result.zoneStatuses,
      liveDiscoveryStatus: result.liveDiscoveryStatus
    }).sections.flatMap((section) => section.routes);
    const acceptedIds = new Set(estimatedOrder.map((route) => route.id));
    const materializedRoutes = estimatedOrder.map((route, searchRank) => ({
      ...result.routes.find((candidate) => candidate.id === route.id)!,
      searchRank
    }));
    const diagnostics = result.diagnostics.concat(
      result.routes
        .filter((candidate) => !acceptedIds.has(candidate.id))
        .map((candidate) => ({
          candidateId: candidate.id,
          accepted: false,
          reason: "diversity_filter"
        }))
    );
    const search = {
      searchId,
      graphVersion: context.env.GRAPH_VERSION ?? result.graphVersion,
      profileHash: context.env.PROFILE_HASH ?? "unversioned-profile",
      overlayHash: context.env.OVERLAY_HASH ?? networkManifest.version,
      rankingHash: context.env.RANKING_HASH ?? "fairness-homeward-v1",
      requestHash: await hashRequest(normalizedPayload),
      snappedStart: snappedStart.point,
      expiresAt,
      routes: materializedRoutes,
      diagnostics,
      zoneStatuses: result.zoneStatuses,
      liveDiscoveryStatus: result.liveDiscoveryStatus
    };
    try {
      await storeRouteSearch(context.env.TRANSIT_CACHE, search);
    } catch (error) {
      console.error("Route search session write failed", error);
    }
    return context.json<RouteSearchResult>(
      await materializePage(search, 0, context.env.PAGE_TOKEN_SECRET)
    );
  } catch (error) {
    console.error("Route search failed", error);
    return context.json<RouteSearchError>(
      { error: "The routing service could not complete this search.", code: "routing_unavailable" },
      503
    );
  }
});

app.get("/api/route-searches/page", async (context) => {
  if (!context.env.TRANSIT_CACHE || !context.env.PAGE_TOKEN_SECRET) {
    return context.json<RouteSearchError>(
      { error: "Route-search sessions are not configured.", code: "routing_unavailable" },
      503
    );
  }
  const token = context.req.query("token");
  const parsed = token ? await readPageToken(token, context.env.PAGE_TOKEN_SECRET) : null;
  if (!parsed || new Date(parsed.expiresAt).getTime() <= Date.now()) {
    return context.json<RouteSearchError>(
      { error: "Route search expired.", code: "search_expired" },
      410
    );
  }
  const search = await loadRouteSearch(context.env.TRANSIT_CACHE, parsed.sessionId);
  if (!search || search.graphVersion !== parsed.graphVersion || new Date(search.expiresAt).getTime() <= Date.now()) {
    return context.json<RouteSearchError>(
      { error: "Route search expired.", code: "search_expired" },
      410
    );
  }
  return context.json(await materializePage(search, parsed.startIndex, context.env.PAGE_TOKEN_SECRET));
});

export default app;
