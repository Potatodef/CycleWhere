const apiBase = process.env.CYCLEWHERE_API_BASE;
if (!apiBase) {
  throw new Error("Set CYCLEWHERE_API_BASE to the Worker origin.");
}

const starts = {
  Tuas: [1.3297, 103.648],
  Jurong: [1.3329, 103.7436],
  Woodlands: [1.436, 103.7865],
  Yishun: [1.4295, 103.835],
  Bishan: [1.3508, 103.8485],
  Punggol: [1.4052, 103.9023],
  Tampines: [1.3533, 103.9451],
  Bedok: [1.3239, 103.9301],
  "Marina Bay": [1.2764, 103.8546],
  Queenstown: [1.2944, 103.8061],
  Clementi: [1.3151, 103.7652],
  Changi: [1.3575, 103.9884]
};

const anchors = {
  west: [1.3151, 103.7652],
  north: [1.436, 103.7865],
  central: [1.3508, 103.8485],
  east: [1.3533, 103.9451],
  northeast: [1.4052, 103.9023]
};

const scenarios = {
  clustered: [anchors.east, [1.3442, 103.9534]],
  distributed: [anchors.west, anchors.north, anchors.east, anchors.northeast],
  outlier: [anchors.east, [1.3442, 103.9534], [1.3575, 103.9884], anchors.west],
  tenRiders: Array.from({ length: 10 }, (_, index) => Object.values(anchors)[index % 5])
};

const failures = [];
const durations = [];
for (const [startName, [lat, lng]] of Object.entries(starts)) {
  for (const [scenarioName, riderPoints] of Object.entries(scenarios)) {
    const started = performance.now();
    const response = await fetch(`${apiBase.replace(/\/$/, "")}/api/route-searches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { label: startName, point: { lat, lng } },
        departureIso: "2026-06-21T10:00:00.000Z",
        participants: riderPoints.map(([riderLat, riderLng], index) => ({
          id: `rider-${index}`,
          name: `Rider ${index + 1}`,
          station: { lat: riderLat, lng: riderLng },
          anchor: {
            id: `anchor-${index}`,
            name: `Anchor ${index + 1}`,
            kind: "rail",
            point: { lat: riderLat, lng: riderLng },
            distanceFromHomeKm: 0,
            fallbackSuggested: false
          }
        }))
      })
    });
    const duration = performance.now() - started;
    durations.push(duration);
    const payload = await response.json();
    const validRoutes =
      response.ok &&
      Array.isArray(payload.routes) &&
      payload.routes.length >= 1 &&
      payload.routes.every(
        (route) =>
          route.distanceKm >= 5 &&
          route.distanceKm <= 35 &&
          Array.isArray(route.graphEdgeIds) &&
          route.graphEdgeIds.length > 0
      );
    if (!validRoutes) {
      failures.push({ startName, scenarioName, status: response.status, payload });
    }
  }
}

durations.sort((left, right) => left - right);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)];
process.stdout.write(
  `${JSON.stringify({ rows: durations.length, failures, p95Ms: percentile(0.95), p99Ms: percentile(0.99) }, null, 2)}\n`
);
if (failures.length || percentile(0.95) > 5000 || percentile(0.99) > 8000) {
  process.exitCode = 1;
}
