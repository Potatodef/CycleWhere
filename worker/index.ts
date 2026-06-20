import { Hono } from "hono";
import { cors } from "hono/cors";
import networkManifest from "../public/data/network-manifest.json";
import { fallbackResolve } from "../src/lib/geocodeFallback.js";
import { estimateTransitMinutes } from "../src/lib/transit.js";
import type {
  DiscoverRoutesRequest,
  DiscoveredRoutesResponse,
  GeocodeResponse,
  TransitTimeQuery,
  TransitTimesResponse
} from "../src/types.js";
import { discoverCyclingRoutes } from "./discovery.js";
import {
  fetchRouteWithOneMap,
  fetchTransitTimeWithOneMap,
  geocodeManyWithOneMap,
  getNearbyTransportWithOneMap
} from "./providers/onemap.js";

type Bindings = {
  TRANSIT_CACHE?: D1Database;
  CORS_ORIGIN?: string;
  ONEMAP_API_EMAIL?: string;
  ONEMAP_API_PASSWORD?: string;
  ONEMAP_BASE_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const MAX_GEOCODE_QUERIES = 12;
const MAX_TRANSIT_QUERIES = 120;
const MAX_PARTICIPANTS = 10;

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
    origin: (origin, context) => resolveCorsOrigin(origin, context.env.CORS_ORIGIN),
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
  tableName: "route_cache" | "nearby_transport_cache",
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
  tableName: "route_cache" | "nearby_transport_cache",
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

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    service: "cyclewhere-api",
    hasD1: Boolean(context.env.TRANSIT_CACHE),
    hasOneMapCredentials: Boolean(
      context.env.ONEMAP_API_EMAIL && context.env.ONEMAP_API_PASSWORD
    ),
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
      const cacheKey = JSON.stringify(query);
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

app.post("/api/discover-cycling-routes", async (context) => {
  const payload = (await context.req.json()) as DiscoverRoutesRequest;
  if (!payload.start?.point || !Array.isArray(payload.participants)) {
    return context.json({ error: "Invalid discovery request." }, 400);
  }
  if (payload.participants.length === 0 || payload.participants.length > MAX_PARTICIPANTS) {
    return context.json({ error: "Invalid participant count." }, 400);
  }

  try {
    const result = await discoverCyclingRoutes(payload, {
      fetchRoute: async ({ start, end, profile }) => {
        const cacheKey = JSON.stringify({
          version: 2,
          profile,
          start: roundedKey(start),
          end: roundedKey(end)
        });
        const cached = await getCachedJson(context.env.TRANSIT_CACHE, "route_cache", cacheKey);
        if (cached) {
          return cached;
        }

        const route = await fetchRouteWithOneMap({ start, end, profile }, context.env);
        if (route) {
          await setCachedJson(context.env.TRANSIT_CACHE, "route_cache", cacheKey, route);
        }
        return route;
      },
      getNearbyTransport: async (point) => {
        const cacheKey = roundedKey(point);
        const cached = await getCachedJson(
          context.env.TRANSIT_CACHE,
          "nearby_transport_cache",
          cacheKey
        );
        if (cached) {
          return cached;
        }

        const nearby = await getNearbyTransportWithOneMap(point, context.env);
        await setCachedJson(
          context.env.TRANSIT_CACHE,
          "nearby_transport_cache",
          cacheKey,
          nearby
        );
        return nearby;
      }
    });

    return context.json<DiscoveredRoutesResponse>(result);
  } catch (error) {
    console.error("Live discovery failed", error);
    return context.json<DiscoveredRoutesResponse>({
      candidates: [],
      curatedCandidates: [],
      zoneStatuses: [],
      liveDiscoveryStatus: "unavailable"
    });
  }
});

export default app;
