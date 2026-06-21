# CycleWhere routing service

CycleWhere routes against a private GraphHopper 11.0 service. The OSM graph is the only
physical topology. Official datasets may annotate matched OSM edges during the offline
build, but unmatched lines never become routable edges.

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
