import { Hono } from "hono";
import { cors } from "hono/cors";
import networkManifest from "../public/data/network-manifest.json";
import { fallbackResolve } from "../src/lib/geocodeFallback.js";
import { estimateTransitMinutes } from "../src/lib/transit.js";
import type {
  GeocodeResponse,
  TransitTimeQuery,
  TransitTimesResponse
} from "../src/types.js";
import { fetchTransitTimeWithOneMap, geocodeManyWithOneMap } from "./providers/onemap.js";

type Bindings = {
  TRANSIT_CACHE?: D1Database;
  CORS_ORIGIN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: (origin, context) => context.env.CORS_ORIGIN || origin || "*",
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

app.get("/api/network-manifest", (context) => context.json(networkManifest));

app.post("/api/geocode", async (context) => {
  const payload = (await context.req.json()) as { queries?: string[] };
  const queries = payload.queries?.filter(Boolean) ?? [];

  if (queries.length === 0) {
    return context.json<GeocodeResponse>({ results: [] });
  }

  try {
    return context.json(await geocodeManyWithOneMap(queries));
  } catch {
    return context.json<GeocodeResponse>({
      results: queries.map((query) => fallbackResolve(query))
    });
  }
});

app.post("/api/transit-times", async (context) => {
  const payload = (await context.req.json()) as { queries?: TransitTimeQuery[] };
  const queries = payload.queries ?? [];
  const results = await Promise.all(
    queries.map(async (query) => {
      const cacheKey = JSON.stringify(query);
      const cached = await getCachedTransit(context.env.TRANSIT_CACHE, cacheKey);
      if (cached !== null) {
        return { minutes: cached, source: "onemap" as const };
      }

      try {
        const result = await fetchTransitTimeWithOneMap(query);
        if (typeof result.minutes === "number") {
          await setCachedTransit(context.env.TRANSIT_CACHE, cacheKey, result.minutes);
          return result;
        }
      } catch {
        // Fall back below.
      }

      return {
        minutes: estimateTransitMinutes(query),
        source: "estimate" as const
      };
    })
  );

  return context.json<TransitTimesResponse>({ results });
});

export default app;
