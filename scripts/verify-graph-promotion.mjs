import { readFile } from "node:fs/promises";

const manifestPath = process.argv[2];
if (!manifestPath) {
  throw new Error("Usage: node scripts/verify-graph-promotion.mjs <graph-manifest.json>");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const requiredStrings = [
  "graphVersion",
  "graphHopperVersion",
  "osmExtractSha256",
  "osmExtractDate",
  "profileHash",
  "overlayHash",
  "rankingHash"
];
for (const field of requiredStrings) {
  if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
    throw new Error(`Graph manifest is missing ${field}.`);
  }
}

const failures = [
  [manifest.routeMatrixPassed !== true, "route matrix"],
  [manifest.continuityPassed !== true, "edge continuity"],
  [manifest.syntheticConnectorCount !== 0, "synthetic connectors"],
  [manifest.namedRouteLabelFailures !== 0, "named-route labels"],
  [typeof manifest.p95WarmSearchMs !== "number" || manifest.p95WarmSearchMs > 5000, "p95 latency"],
  [typeof manifest.p99WarmSearchMs !== "number" || manifest.p99WarmSearchMs > 8000, "p99 latency"]
].filter(([failed]) => failed);

if (failures.length) {
  throw new Error(`Graph promotion rejected: ${failures.map(([, name]) => name).join(", ")}.`);
}

process.stdout.write(`Graph ${manifest.graphVersion} passed promotion gates.\n`);
