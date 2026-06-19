# CycleWhere MVP

CycleWhere is a route-first Singapore group cycling planner for 2 to 10 people. It generates curated corridor routes plus bounded live-discovery routes, then ranks them by how fair the public-transport journey home is for the group.

## Stack

- Front end: React, Vite, TypeScript, MapLibre
- Planner engine: browser Web Worker plus shared TypeScript modules
- API: Hono on Cloudflare Workers
- Cache/data: Cloudflare D1
- External routing/geocoding: OneMap

## What is implemented

- Two-step resolve-then-plan flow
- Curated Singapore corridor candidates
- Hybrid planner that merges curated and live-discovered routes
- Fairness-first scoring using participant-level journey-home times
- Sectioned results:
  - Trusted corridor matches
  - Best discovered routes
  - Curated alternatives
  - Majority-friendly uneven
- OneMap-backed Worker endpoints for:
  - geocoding
  - transit times
  - bounded cycling-route discovery

## Local development

Install dependencies and run the app:

```bash
npm install
npm run dev
```

Run checks:

```bash
npm run check
npm run build
```

The front end works without a configured backend by falling back to local geocoding heuristics and transit estimates.

If you want `wrangler dev` to use real OneMap credentials locally, create `.dev.vars` from `.dev.vars.example`.

To use the Worker endpoints locally or in production, expose the Worker under:

```bash
VITE_API_BASE=https://your-worker.example.com
```

## API shape

- `POST /api/geocode`
- `POST /api/transit-times`
- `POST /api/discover-cycling-routes`
- `GET /api/health`
- `GET /api/network-manifest`

Raw participant addresses are not persisted by the sample API layer. The Worker caches only route/transit/nearby-transport results keyed by rounded coordinates or request payloads.

## Cloudflare setup

### 1. Configure D1

Create a D1 database, then replace the placeholder `database_id` in [wrangler.toml](./wrangler.toml).

Apply the schema:

```bash
npx wrangler d1 execute cyclewhere-transit-cache --file worker/schema.sql --remote
```

### 2. Configure Worker secrets

Set OneMap credentials in the Worker:

```bash
npx wrangler secret put ONEMAP_API_EMAIL
npx wrangler secret put ONEMAP_API_PASSWORD
```

For local development, [wrangler.toml](./wrangler.toml) allows `http://127.0.0.1:5173` and `http://127.0.0.1:5174`.

Before production deploys, replace the placeholder in the `[env.production.vars]` section with your real frontend origin.

### 3. Deploy the Worker

```bash
npm run worker:deploy
```

Smoke-test the deployed Worker:

```bash
curl https://your-worker-subdomain.workers.dev/api/health
```

## GitHub setup

CI is already configured to run:

- `npm run check`
- `npm run build`

on pushes to `main` and on pull requests.

This repo now also includes a conditional deploy workflow for GitHub Actions. To enable it:

1. Add these GitHub repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
2. Optionally add this secret if you want the built web app deployed to Cloudflare Pages from GitHub Actions:
   - `CLOUDFLARE_PAGES_PROJECT`
3. Make sure the Worker secrets `ONEMAP_API_EMAIL` and `ONEMAP_API_PASSWORD` already exist in Cloudflare, because deploys do not create them automatically.
4. Push to `main` or manually trigger the workflow from the Actions tab.

The deploy workflow is safe before secrets are configured:

- the normal CI job still runs
- deploy jobs are skipped until the required secrets exist

## Notes

- The current live discovery is bounded to the curated cycling zones. It is not an islandwide optimizer.
- Walking/running-style routes are only used as discovery spines and must be cycling-validated before they can appear as cycling results.
