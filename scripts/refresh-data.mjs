import fs from "node:fs/promises";
import path from "node:path";

const datasets = [
  {
    name: "LTA Cycling Path Network",
    datasetId: "d_8f468b25193f64be8a16fa7d8f60f553",
    purpose: "Cycling infrastructure"
  },
  {
    name: "NParks Tracks",
    datasetId: "d_306cc1018cb733346681883ee6d73054",
    purpose: "Park tracks with cycling allowances"
  },
  {
    name: "Park Connector Loop",
    datasetId: "d_a69ef89737379f231d2ae93fd1c5707f",
    purpose: "Named park connector loops"
  },
  {
    name: "MRT Station Exit",
    datasetId: "d_b39d3a0871985372d7e1637193335da5",
    purpose: "Transit anchor snapping"
  },
  {
    name: "Bus Stop",
    datasetId: "d_3f172c6feb3f4f92a2f47d93eed2908a",
    purpose: "Bus fallback anchors"
  }
];

const reviewedOn = new Date().toISOString().slice(0, 10);
const manifest = {
  version: reviewedOn,
  datasets: datasets.map((dataset) => ({
    ...dataset,
    reviewedOn
  })),
  corridors: [
    "Round Island Route",
    "Eastern Coastal Loop",
    "North Eastern Riverine Loop",
    "Jurong-West Coast Green Spine",
    "Kallang Basin Connector"
  ]
};

const target = path.join(process.cwd(), "public", "data", "network-manifest.json");
await fs.writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated ${target}`);
