# Contributing

## Local Setup

1. Install Node.js 22.
2. Run `npm ci`.
3. Copy `.dev.vars.example` to `.dev.vars` if you need local Worker secrets.
4. Start the frontend with `npm run dev`.
5. Start the Worker with `npm run worker:dev`.

## Quality Checks

Run these before opening a pull request:

```bash
npm run check
npm run build
```

## Deployment

Production deploys use Cloudflare Workers and Pages through `.github/workflows/deploy.yml`.
Keep `VITE_API_BASE` unset for normal Pages deploys unless the target API host is also allowed by `public/_headers`.

## Data

`public/data/verified-network.json` is the checked-in verified cycling network snapshot used by the app.
Large generated GraphHopper/runtime files should stay out of Git unless there is an explicit migration plan.
