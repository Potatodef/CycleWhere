# CycleWhere routing service

CycleWhere routes against a private GraphHopper 11.0 service. The OSM graph is the only
physical topology. Official datasets may annotate matched OSM edges during the offline
build, but unmatched lines never become routable edges.

## Fast bootstrap on Ubuntu

If you do not have the audited graph artifacts yet, you can still stand up a bootstrap
instance against the raw Geofabrik Singapore/Malaysia/Brunei extract:

1. Run `./routing/bootstrap-local.sh`
2. Run `./routing/start-local.sh`
3. Wait for `GET http://127.0.0.1:8989/health` to respond
4. Put an HTTPS reverse proxy in front of port `8989`
5. Point the Worker's `GRAPHHOPPER_BASE_URL` at that public HTTPS origin

This bootstrap path is intentionally operational, not canonical. It skips the audited
overlay conflation build and therefore should not be treated as the final promoted graph.
It also avoids depending on Docker image pulls, which is useful on machines with broken
registry mirrors or older system Java installs.

If you need to replace a bad local download, rerun with
`ROUTING_FORCE_DOWNLOAD=1 ./routing/bootstrap-local.sh`.

## Required build outputs

Place these immutable artifacts in `routing/data/` before starting GraphHopper:

- `singapore-enriched.osm.pbf`: bicycle-accessible OSM data enriched by the audited
  overlay conflation build.
- `overlay-sidecar.json`: source IDs, source geometry, sample/heading evidence, and
  imported base-edge references.
- `graph-manifest.json`: source checksums, engine/profile/overlay hashes, audit results,
  route-matrix results, and performance measurements.

The conflation builder must split ways at accepted match boundaries. A match is accepted
only when at least 80% of ten-metre samples are within 25 metres of one continuous OSM
chain and heading differs by at most 30 degrees. The 25-metre threshold is map matching
only; it must never create a connector.

## Promotion

1. Build and import a new graph without touching the active service.
2. Run graph-edge continuity, access-policy, route-matrix, browser, and load tests against
   the candidate instance.
3. Record results in `graph-manifest.json` and run
   `npm run graph:verify -- routing/data/graph-manifest.json`.
4. Start the candidate instance and verify `/health` plus all version hashes.
5. Change the Worker's GraphHopper URL and version hashes only after the verifier passes.

Searches store route geometry and ordering in D1, so active 15-minute sessions do not
depend on the old graph remaining reachable. Keep the old instance for 30 minutes for
operational rollback and diagnostics.

## Worker configuration

Set `GRAPHHOPPER_BASE_URL`, `GRAPH_VERSION`, `PROFILE_HASH`, `OVERLAY_HASH`, and
`RANKING_HASH` as production Worker variables. Set `GRAPHHOPPER_BEARER_TOKEN` and
`PAGE_TOKEN_SECRET` with `wrangler secret put`; never commit them.

The Worker returns `503 routing_unavailable` until the graph, D1 schema, and page-token
secret are configured. This is deliberate: infrastructure failure must not appear as a
normal zero-route result.

For the bootstrap path, use explicit placeholder versioning instead of pretending you
have the audited artifacts. For example:

- `GRAPH_VERSION=bootstrap-raw-osm-YYYY-MM-DD`
- `PROFILE_HASH=<sha256 of routing/config/custom-models/*.json plus config choices>`
- `OVERLAY_HASH=bootstrap-no-overlay`

## Hosted API mode

If you do not want to run your own GraphHopper server, the Worker can use the hosted
GraphHopper Directions API instead. This mode is intended for low-traffic personal use.

1. Put `GRAPHHOPPER_API_KEY` into Worker secrets
2. Do not set `GRAPHHOPPER_BASE_URL`
3. Keep `PAGE_TOKEN_SECRET` and D1 configured as usual

In hosted mode, the Worker:

- uses the hosted `bike` profile instead of the self-hosted custom profile names
- reduces endpoint fan-out to keep credit usage down
- skips the explicit self-hosted `/nearest` snap step and lets GraphHopper snap points
  during route calculation

Use the exact secret name `GRAPHHOPPER_API_KEY`.
A legacy fallback for a misnamed `GRAPHOPPER_API_KEY` secret exists temporarily for
backward compatibility, but the correct standardized name is `GRAPHHOPPER_API_KEY`.
