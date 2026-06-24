# CycleWhere Handover

## Current state

- Repo branch: `main`
- Working tree: clean
- Frontend production URL: `https://cyclewhere.pages.dev`
- Backend production URL: `https://cyclewhere-api-production.cyclewhere.workers.dev`
- Backend health endpoint: `GET https://cyclewhere-api-production.cyclewhere.workers.dev/api/health`

## Architecture

This repo has 3 main pieces:

1. Frontend
- React + Vite + TypeScript
- Main UI: `src/App.tsx`
- Static production build output: `dist/`
- Hosted on Cloudflare Pages

2. Backend API
- Hono app running on Cloudflare Workers
- Entry point: `worker/index.ts`
- Live route discovery: `worker/discovery.ts`
- OneMap integration: `worker/providers/onemap.ts`

3. Cache/database
- Cloudflare D1
- Schema: `worker/schema.sql`
- Used for caching route, transit, and nearby transport results

The frontend calls the backend, and the backend calls OneMap plus D1.

## Planner behavior

- Curated corridor candidates come from repo data
- Live-discovered route candidates come from the Worker
- Fairness is computed in TypeScript planner code, not by OneMap
- Route ranking is fairness-first
- Results are grouped into:
  - trusted corridor matches
  - best discovered routes
  - curated alternatives
  - majority-friendly uneven

## Production config

Worker config is in `wrangler.toml`.

Important production values:

- production CORS origin:
  - `https://cyclewhere.pages.dev`
- production D1 binding:
  - `TRANSIT_CACHE`

## GitHub Actions / CI-CD

Workflows:

- CI: `.github/workflows/ci.yml`
- Deploy: `.github/workflows/deploy.yml`
- Data refresh: `.github/workflows/data-refresh.yml`

Deploy workflow behavior:

1. Deploy Worker
- `npm ci`
- `npm run check`
- `npx wrangler whoami`
- `npx wrangler deploy worker/index.ts --env production`

2. Deploy Pages
- `npm ci`
- `npm run build`
- `npx wrangler whoami`
- `npx wrangler pages deploy dist --project-name="$CLOUDFLARE_PAGES_PROJECT"`

GitHub Actions required secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`

GitHub Actions required variable:

- `VITE_API_BASE=https://cyclewhere-api-production.cyclewhere.workers.dev`

Runtime secrets live in Cloudflare, not GitHub:

- `ONEMAP_API_EMAIL`
- `ONEMAP_API_PASSWORD`

## Local development

### Frontend only against live backend

On another computer:

```bash
git clone <repo-url>
cd CycleWhere
npm install
printf 'VITE_API_BASE=https://cyclewhere-api-production.cyclewhere.workers.dev\n' > .env.local
npm run dev
```

Then open the Vite URL, usually `http://127.0.0.1:5173`.

This is enough if you only want to work on frontend or general app behavior while using the already-live backend.

### Full local stack

If you want local frontend plus local Worker:

```bash
git clone <repo-url>
cd CycleWhere
npm install
printf 'VITE_API_BASE=http://127.0.0.1:8787\n' > .env.local
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars` with:

```bash
ONEMAP_API_EMAIL=...
ONEMAP_API_PASSWORD=...
```

Then run:

```bash
npm run worker:dev
npm run dev
```

Notes:

- `.env.local` is frontend-only and machine-specific
- `.dev.vars` is Worker-only and machine-specific
- both are intentionally ignored by git

## Manual deploy commands

From the repo root:

### Deploy Worker

```bash
npm run worker:deploy
```

### Build frontend for production manually

```bash
VITE_API_BASE=https://cyclewhere-api-production.cyclewhere.workers.dev npm run build
```

## Useful checks

### Backend health

```bash
curl https://cyclewhere-api-production.cyclewhere.workers.dev/api/health
```

Expected:

- `ok: true`
- `hasD1: true`
- `hasOneMapCredentials: true`

### Example geocode

```bash
curl -X POST https://cyclewhere-api-production.cyclewhere.workers.dev/api/geocode \
  -H 'Content-Type: application/json' \
  -d '{"queries":["Marina Bay"]}'
```

## What another Codex should know immediately

- The frontend and backend are already merged and consistent
- Production hosting is intended to be:
  - frontend on Cloudflare Pages
  - backend on Cloudflare Workers
  - cache on Cloudflare D1
- `vite dev` is only local development, never production hosting
- If CI/CD fails, first inspect:
  - `.github/workflows/deploy.yml`
  - GitHub secrets/variables
  - `wrangler whoami` step in Actions logs

