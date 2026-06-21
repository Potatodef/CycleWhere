import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.join(process.cwd(), "public", "data");
const MIN_SEGMENT_KM = 0.15;
const CANDIDATE_SPACING_KM = 2;
const CANDIDATE_DEDUPE_KM = 0.3;
const COVERAGE_SPACING_KM = 0.08;
const COVERAGE_DEDUPE_KM = 0.04;
const NAMED_ROUTE_JOIN_KM = 2;

const routeDatasets = [
  {
    name: "LTA Cycling Path Network",
    datasetId: "d_8f468b25193f64be8a16fa7d8f60f553",
    kind: "cycling-path"
  },
  {
    name: "Park Connector Loop",
    datasetId: "d_a69ef89737379f231d2ae93fd1c5707f",
    kind: "park-connector"
  }
];

const busStopDataset = {
  datasetId: "d_3f172c6feb3f4f92a2f47d93eed2908a",
  name: "LTA Bus Stops"
};

const namedRouteConfigs = [
  {
    id: "round-island-route",
    name: "Round Island Route",
    layerId: 6,
    publishedDistanceKm: 75,
    surface: "paved"
  },
  {
    id: "rail-corridor",
    name: "Rail Corridor",
    layerId: 7,
    publishedDistanceKm: 24,
    surface: "mixed"
  },
  {
    id: "eastern-corridor",
    name: "Eastern Corridor",
    layerId: 10,
    publishedDistanceKm: 18,
    surface: "paved"
  }
];

const verifiedOn = new Date().toISOString().slice(0, 10);

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

function polylineDistanceKm(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineKm(points[index - 1], points[index]);
  }
  return total;
}

function cumulativeDistances(points) {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + haversineKm(points[index - 1], points[index]));
  }
  return distances;
}

function interpolate(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t
  };
}

function sampleLine(points, spacingKm) {
  if (points.length < 2) {
    return points;
  }

  const distances = cumulativeDistances(points);
  const totalDistance = distances[distances.length - 1] ?? 0;
  if (totalDistance <= 0) {
    return [points[0], points[points.length - 1]];
  }

  const sampled = [points[0]];
  for (let target = spacingKm; target < totalDistance; target += spacingKm) {
    let segmentIndex = 1;
    while (segmentIndex < distances.length && (distances[segmentIndex] ?? 0) < target) {
      segmentIndex += 1;
    }

    const endIndex = Math.min(segmentIndex, points.length - 1);
    const startIndex = Math.max(0, endIndex - 1);
    const segmentStart = points[startIndex];
    const segmentEnd = points[endIndex];
    const segmentDistance = (distances[endIndex] ?? 0) - (distances[startIndex] ?? 0);
    const distanceIntoSegment = target - (distances[startIndex] ?? 0);
    const ratio = segmentDistance <= 0 ? 0 : distanceIntoSegment / segmentDistance;
    sampled.push(interpolate(segmentStart, segmentEnd, ratio));
  }
  sampled.push(points[points.length - 1]);
  return sampled;
}

async function fetchDataset(datasetId) {
  let downloadUrl = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(
      `https://api-open.data.gov.sg/v1/public/api/datasets/${datasetId}/poll-download`
    );
    if (!response.ok) {
      if (response.status === 429 && attempt < 7) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        continue;
      }
      throw new Error(`Dataset ${datasetId} poll failed (${response.status})`);
    }
    const payload = await response.json();
    downloadUrl = payload?.data?.url ?? null;
    if (downloadUrl) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!downloadUrl) {
    throw new Error(`Dataset ${datasetId} did not produce a download URL`);
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Dataset ${datasetId} download failed (${response.status})`);
  }

  return response.json();
}

async function fetchNamedRouteLayer(layerId) {
  const url = new URL(
    `https://services6.arcgis.com/s5gdswleLl0QthYa/arcgis/rest/services/Park_Connector_Trails_WFL1/FeatureServer/${layerId}/query`
  );
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "geojson");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Named route layer ${layerId} failed (${response.status})`);
  }

  return response.json();
}

function toLatLngPoints(coordinates) {
  return coordinates
    .map((coordinate) => {
      const [lng, lat] = coordinate;
      if (typeof lat !== "number" || typeof lng !== "number") {
        return null;
      }
      return { lat, lng };
    })
    .filter(Boolean);
}

function normalizeLines(geometry) {
  if (!geometry?.type || !geometry?.coordinates) {
    return [];
  }
  if (geometry.type === "LineString") {
    return [toLatLngPoints(geometry.coordinates)];
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.map((line) => toLatLngPoints(line));
  }
  return [];
}

function featureName(properties, fallback) {
  return (
    properties.CYL_PATH ||
    properties.PARK ||
    properties.PCN_LOOP ||
    properties.NAME ||
    properties.ROAD_NAME ||
    properties.MORE_INFO ||
    fallback
  );
}

function featureId(properties, partIndex) {
  const raw =
    properties.OBJECTID_1 ??
    properties.OBJECTID ??
    properties.INC_CRC ??
    properties.FID ??
    properties.ID ??
    partIndex;
  return `${raw}`;
}

function dedupePoints(points, radiusKm, merge) {
  const kept = [];

  for (const point of points) {
    const existing = kept.find((candidate) => haversineKm(candidate.point, point.point) <= radiusKm);
    if (existing) {
      merge(existing, point);
      continue;
    }
    kept.push(point);
  }

  return kept;
}

function compileSegments(dataset, featureCollection) {
  const segments = [];

  for (const feature of featureCollection.features ?? []) {
    const lines = normalizeLines(feature.geometry);
    const properties = feature.properties ?? {};

    lines.forEach((geometry, partIndex) => {
      if (geometry.length < 2) {
        return;
      }

      const lengthKm = polylineDistanceKm(geometry);
      if (lengthKm < MIN_SEGMENT_KM) {
        return;
      }

      const sourceFeatureId = `${featureId(properties, partIndex)}-${partIndex}`;
      segments.push({
        id: `${dataset.kind}-${sourceFeatureId}`,
        sourceDataset: dataset.datasetId,
        sourceFeatureId,
        name: featureName(properties, dataset.name),
        kind: dataset.kind,
        verifiedOn,
        lengthKm: Math.round(lengthKm * 1000) / 1000,
        geometry
      });
    });
  }

  return segments;
}

function buildCandidatePoints(segments) {
  const rawPoints = segments.flatMap((segment) =>
    sampleLine(segment.geometry, CANDIDATE_SPACING_KM).map((point) => ({
      point,
      sourceKinds: new Set([segment.kind]),
      nearbyFeatureIds: new Set([segment.id])
    }))
  );

  return dedupePoints(rawPoints, CANDIDATE_DEDUPE_KM, (existing, incoming) => {
    incoming.sourceKinds.forEach((kind) => existing.sourceKinds.add(kind));
    incoming.nearbyFeatureIds.forEach((featureId) => existing.nearbyFeatureIds.add(featureId));
  }).map((point, index) => ({
    id: `candidate-${index + 1}`,
    point: point.point,
    sourceKinds: [...point.sourceKinds].sort(),
    nearbyFeatureIds: [...point.nearbyFeatureIds].sort()
  }));
}

function buildCoveragePoints(segments) {
  const rawPoints = segments.flatMap((segment) =>
    sampleLine(segment.geometry, COVERAGE_SPACING_KM).map((point) => ({
      point,
      kind: segment.kind,
      sourceDataset: segment.sourceDataset,
      sourceFeatureId: segment.id
    }))
  );

  return dedupePoints(rawPoints, COVERAGE_DEDUPE_KM, () => {}).map((point) => ({
    point: point.point,
    kind: point.kind,
    sourceDataset: point.sourceDataset,
    sourceFeatureId: point.sourceFeatureId
  }));
}

function normalizeBusAnchors(featureCollection) {
  return (featureCollection.features ?? [])
    .map((feature) => {
      if (feature.geometry?.type !== "Point") {
        return null;
      }
      const [lng, lat] = feature.geometry.coordinates ?? [];
      const id = feature.properties?.BUS_STOP_NUM;
      if (typeof lat !== "number" || typeof lng !== "number" || !id) {
        return null;
      }
      return {
        id: `bus-${id}`,
        name: `Bus stop ${id}`,
        point: { lat, lng }
      };
    })
    .filter(Boolean);
}

function stitchRouteGeometry(lines, maxJoinKm) {
  const remaining = lines
    .filter((line) => line.length >= 2)
    .map((points, index) => ({
      id: index,
      points,
      lengthKm: polylineDistanceKm(points)
    }))
    .sort((left, right) => right.lengthKm - left.lengthKm);

  const seed = remaining.shift();
  if (!seed) {
    return null;
  }

  let geometry = seed.points.slice();

  while (remaining.length > 0) {
    const start = geometry[0];
    const end = geometry[geometry.length - 1];
    let best = null;

    for (const candidate of remaining) {
      const first = candidate.points[0];
      const last = candidate.points[candidate.points.length - 1];
      const options = [
        { side: "end", reverse: false, gapKm: haversineKm(end, first) },
        { side: "end", reverse: true, gapKm: haversineKm(end, last) },
        { side: "start", reverse: false, gapKm: haversineKm(start, last) },
        { side: "start", reverse: true, gapKm: haversineKm(start, first) }
      ].sort((left, right) => left.gapKm - right.gapKm);

      const option = options[0];
      if (!best || option.gapKm < best.gapKm) {
        best = { candidate, ...option };
      }
    }

    if (!best || best.gapKm > maxJoinKm) {
      break;
    }

    const nextGeometry = best.reverse
      ? best.candidate.points.slice().reverse()
      : best.candidate.points.slice();

    geometry =
      best.side === "end"
        ? geometry.concat(nextGeometry.slice(1))
        : nextGeometry.slice(0, -1).concat(geometry);

    const removeIndex = remaining.findIndex((candidate) => candidate.id === best.candidate.id);
    remaining.splice(removeIndex, 1);
  }

  return {
    geometry,
    remainingPartCount: remaining.length,
    lengthKm: polylineDistanceKm(geometry)
  };
}

function compileNamedRoute(config, featureCollection) {
  const features = featureCollection.features ?? [];
  const lines = features.flatMap((feature) => normalizeLines(feature.geometry));
  const stitched = stitchRouteGeometry(lines, NAMED_ROUTE_JOIN_KM);

  if (!stitched || stitched.geometry.length < 2) {
    return null;
  }

  const distanceDeltaRatio =
    Math.abs(stitched.lengthKm - config.publishedDistanceKm) / config.publishedDistanceKm;
  const tooManyUnusedParts = stitched.remainingPartCount > Math.ceil(lines.length / 3);

  if (distanceDeltaRatio > 0.15 || tooManyUnusedParts) {
    return null;
  }

  return {
    id: config.id,
    name: config.name,
    kind: "corridor",
    surface: config.surface,
    publishedDistanceKm: config.publishedDistanceKm,
    sourceDataset: `nparks:park-connector-trails:${config.id}`,
    sourceFeatureIds: features
      .map((feature) => feature.properties?.OBJECTID)
      .filter((value) => value !== undefined && value !== null)
      .map((value) => `${config.id}:${value}`),
    geometry: stitched.geometry
  };
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const [routeFeatureCollections, busStopsFeatureCollection, namedRouteFeatureCollections] = await Promise.all([
  Promise.all(
    routeDatasets.map(async (dataset) => ({
      dataset,
      featureCollection: await fetchDataset(dataset.datasetId)
    }))
  ),
  fetchDataset(busStopDataset.datasetId),
  Promise.all(
    namedRouteConfigs.map(async (config) => ({
      config,
      featureCollection: await fetchNamedRouteLayer(config.layerId)
    }))
  )
]);

const routeSegments = routeFeatureCollections.flatMap(({ dataset, featureCollection }) =>
  compileSegments(dataset, featureCollection)
);
const namedRoutes = namedRouteFeatureCollections
  .map(({ config, featureCollection }) => compileNamedRoute(config, featureCollection))
  .filter(Boolean);
const namedRouteSegments = namedRoutes.map((route) => ({
  id: `official-route-${route.id}`,
  sourceDataset: route.sourceDataset,
  sourceFeatureId: route.id,
  name: route.name,
  kind: "official-route",
  verifiedOn,
  lengthKm: Math.round(polylineDistanceKm(route.geometry) * 1000) / 1000,
  geometry: route.geometry
}));
const candidatePoints = buildCandidatePoints(routeSegments);
const coveragePoints = buildCoveragePoints(routeSegments.concat(namedRouteSegments));
const busAnchors = normalizeBusAnchors(busStopsFeatureCollection);

const verifiedNetwork = {
  version: verifiedOn,
  sourcePolicy:
    "Official Singapore cycling routes only: LTA cycling paths, NParks park connector loops, selected named official corridors, and LTA bus stops for static anchor checks.",
  datasets: routeDatasets
    .map((dataset) => ({
      name: dataset.name,
      datasetId: dataset.datasetId,
      kind: dataset.kind,
      verifiedOn
    }))
    .concat(
      namedRoutes.map((route) => ({
        name: route.name,
        datasetId: route.sourceDataset,
        kind: "official-route",
        verifiedOn
      }))
    ),
  segments: routeSegments,
  candidatePoints,
  coveragePoints,
  busAnchors,
  namedRoutes
};

const manifest = {
  version: verifiedOn,
  datasets: verifiedNetwork.datasets,
  sourcePolicy: verifiedNetwork.sourcePolicy,
  segmentCount: routeSegments.length,
  candidatePointCount: candidatePoints.length,
  busAnchorCount: busAnchors.length,
  namedRouteCount: namedRoutes.length
};

await fs.writeFile(
  path.join(OUTPUT_DIR, "verified-network.json"),
  `${JSON.stringify(verifiedNetwork, null, 2)}\n`
);
await fs.writeFile(
  path.join(OUTPUT_DIR, "network-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(
  `Compiled ${routeSegments.length} verified segments, ${candidatePoints.length} candidate points, ${namedRoutes.length} named routes, and ${busAnchors.length} bus anchors.`
);
