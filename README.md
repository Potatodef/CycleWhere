<<<<<<< HEAD
# CycleWhere MVP

CycleWhere is a route-first Singapore group cycling planner for 2 to 10 people. It looks for route endpoints that keep everyone's journey home reasonably fair by public transport, then returns multiple route options from the same start point in ascending distance order.

The current MVP ships with:

- A React and Vite front end with a route map, themed A/B-able visual system, and a two-step resolve-then-plan flow.
- A routing Web Worker that scores route candidates by journey-home time spread first, then by standard deviation, corridor coverage, and distance diversity.
- A Hono worker API for geocoding, transit times, and a versioned network manifest, with a D1-backed transit cache.
- Seeded Singapore corridor and anchor data so the experience still works before live open-data ingestion is fully wired.

## Product rules implemented

- Start time defaults to current local time rounded to five minutes.
- Homes resolve to a nearest MRT or LRT anchor first, with a bus fallback when rail is over 2.5 km away.
- Results are route-first and sorted from the shortest route to the longest.
- Fairness tiers:
  - Excellent: under 10 minutes
  - Fair: 10 to 20 minutes
  - Stretched: 20 to 30 minutes
  - Uneven: above 30 minutes
- For groups of four or more, up to two majority-friendly uneven routes can still appear separately.
- Running is intentionally deferred, but the code keeps an `ActivityProfile` type so we can extend cleanly.

## Stack

- Front end: React, Vite, TypeScript, MapLibre
- Planner engine: Web Worker plus shared TypeScript modules
- API: Hono Worker
- Cache: Cloudflare D1
- Hosting target: Cloudflare Pages for the web app plus a Worker for APIs
- Repo/license: public-friendly MIT

## Local development

```bash
npm install
npm run dev
```

The front end works without a configured backend by falling back to local geocoding heuristics and transit estimates. To use the Worker endpoints, expose them under:

```bash
VITE_API_BASE=https://your-worker.example.com
```

## API shape

- `POST /api/geocode`
- `POST /api/transit-times`
- `GET /api/network-manifest`

Raw addresses and participant names are intended to remain session-only. The sample API layer does not persist them to D1; only aggregated transit cache keys are stored.

## Deploy

Build the site:

```bash
npm run build
```

Deploy the Worker:

```bash
npm run worker:deploy
```

Before deploying for real, update [wrangler.toml](./wrangler.toml) with a real D1 database ID and tighten `CORS_ORIGIN`.

## Notes on live data

The app is structured around Singapore open-data and official route evidence, but this MVP intentionally keeps the actual graph lightweight so the repo stays easy to run and inspect. The next production step is to replace the seeded corridor geometry with a generated graph from LTA, NParks, Park Connector Loop, and OSM data while keeping the same planner interfaces.
=======
# CycleWhere
Vibe Coded idea I got from Soong QR 
>>>>>>> 3c6ebb051fd4d8f78b4f45f51516570ac64ce7fb
