import type { CorridorSeed } from "../types";

export const corridorSeeds: CorridorSeed[] = [
  {
    id: "ecp-changi",
    name: "ECP to Changi",
    endpointName: "Changi Village",
    endpoint: { lat: 1.3895, lng: 103.987 },
    preferredAnchorId: "changi-village-bus-terminal",
    basePcnCoverage: 0.86,
    baseCyclingPathCoverage: 0.09,
    baseCommonCorridorCoverage: 0.74,
    baseMixedTrafficMeters: 120,
    evidence: [
      { label: "NParks Round Island Route", url: "https://pcn.nparks.gov.sg/know-our-pcn/rir/", reviewedOn: "2026-06-18" },
      { label: "Google Maps cycling route example", url: "https://www.google.com/maps", reviewedOn: "2026-06-18" }
    ],
    detours: [
      { id: "direct", name: "East Coast push", distanceMultiplier: 1, controlPoints: [{ t: 0.4, perpendicularKm: 0.5 }] },
      { id: "scenic", name: "Lagoon scenic", distanceMultiplier: 1.12, controlPoints: [{ t: 0.35, perpendicularKm: 1.8 }, { t: 0.7, perpendicularKm: 0.9 }] },
      { id: "long", name: "Changi coast stretch", distanceMultiplier: 1.27, controlPoints: [{ t: 0.3, perpendicularKm: 2.3 }, { t: 0.75, perpendicularKm: 1.5 }] }
    ]
  },
  {
    id: "kallang-marina-loop",
    name: "Kallang Basin Loop",
    endpointName: "Marina Barrage",
    endpoint: { lat: 1.2807, lng: 103.8705 },
    preferredAnchorId: "marina-bay-mrt",
    basePcnCoverage: 0.7,
    baseCyclingPathCoverage: 0.22,
    baseCommonCorridorCoverage: 0.64,
    baseMixedTrafficMeters: 180,
    evidence: [
      { label: "Round Island Route", url: "https://pcn.nparks.gov.sg/know-our-pcn/rir/", reviewedOn: "2026-06-18" },
      { label: "Kallang Basin leisure routes", url: "https://pcn.nparks.gov.sg/", reviewedOn: "2026-06-18" }
    ],
    detours: [
      { id: "direct", name: "Stadium line", distanceMultiplier: 1, controlPoints: [{ t: 0.5, perpendicularKm: -0.8 }] },
      { id: "scenic", name: "Marina promenade", distanceMultiplier: 1.16, controlPoints: [{ t: 0.3, perpendicularKm: -1.8 }, { t: 0.7, perpendicularKm: 1.2 }] },
      { id: "long", name: "Bay loop extension", distanceMultiplier: 1.33, controlPoints: [{ t: 0.2, perpendicularKm: -2 }, { t: 0.55, perpendicularKm: 2.4 }, { t: 0.8, perpendicularKm: 1.2 }] }
    ]
  },
  {
    id: "north-east-loop",
    name: "North Eastern Riverine Loop",
    endpointName: "Punggol Waterway",
    endpoint: { lat: 1.4069, lng: 103.9064 },
    preferredAnchorId: "punggol-mrt-lrt",
    basePcnCoverage: 0.8,
    baseCyclingPathCoverage: 0.12,
    baseCommonCorridorCoverage: 0.66,
    baseMixedTrafficMeters: 140,
    evidence: [
      { label: "Round Island Route", url: "https://pcn.nparks.gov.sg/know-our-pcn/rir/", reviewedOn: "2026-06-18" },
      { label: "Punggol Waterway routes", url: "https://pcn.nparks.gov.sg/", reviewedOn: "2026-06-18" }
    ],
    detours: [
      { id: "direct", name: "Riverway run", distanceMultiplier: 1, controlPoints: [{ t: 0.6, perpendicularKm: 0.7 }] },
      { id: "scenic", name: "Coney coast glide", distanceMultiplier: 1.14, controlPoints: [{ t: 0.42, perpendicularKm: 2 }, { t: 0.77, perpendicularKm: 1.1 }] },
      { id: "long", name: "Waterway full sweep", distanceMultiplier: 1.29, controlPoints: [{ t: 0.25, perpendicularKm: 2.1 }, { t: 0.6, perpendicularKm: -1.7 }, { t: 0.82, perpendicularKm: 2.3 }] }
    ]
  },
  {
    id: "bishan-kallang-spine",
    name: "Bishan to Marina Spine",
    endpointName: "Bishan-Ang Mo Kio Park",
    endpoint: { lat: 1.3651, lng: 103.8425 },
    preferredAnchorId: "bishan-mrt",
    basePcnCoverage: 0.77,
    baseCyclingPathCoverage: 0.11,
    baseCommonCorridorCoverage: 0.55,
    baseMixedTrafficMeters: 150,
    evidence: [
      { label: "Park Connector Network", url: "https://pcn.nparks.gov.sg/", reviewedOn: "2026-06-18" }
    ],
    detours: [
      { id: "direct", name: "Park spine", distanceMultiplier: 1, controlPoints: [{ t: 0.5, perpendicularKm: 0.5 }] },
      { id: "scenic", name: "Kallang tributary", distanceMultiplier: 1.18, controlPoints: [{ t: 0.33, perpendicularKm: -1.4 }, { t: 0.66, perpendicularKm: 1.7 }] },
      { id: "long", name: "MacRitchie extension", distanceMultiplier: 1.31, controlPoints: [{ t: 0.25, perpendicularKm: -2.1 }, { t: 0.55, perpendicularKm: 2.4 }, { t: 0.8, perpendicularKm: 1.4 }] }
    ]
  },
  {
    id: "west-coast-green",
    name: "Jurong to West Coast Green Spine",
    endpointName: "West Coast Park",
    endpoint: { lat: 1.2937, lng: 103.7698 },
    preferredAnchorId: "clementi-mrt",
    basePcnCoverage: 0.73,
    baseCyclingPathCoverage: 0.14,
    baseCommonCorridorCoverage: 0.52,
    baseMixedTrafficMeters: 190,
    evidence: [
      { label: "Round Island Route", url: "https://pcn.nparks.gov.sg/know-our-pcn/rir/", reviewedOn: "2026-06-18" }
    ],
    detours: [
      { id: "direct", name: "Coastal cut", distanceMultiplier: 1, controlPoints: [{ t: 0.55, perpendicularKm: -0.7 }] },
      { id: "scenic", name: "Clementi woods", distanceMultiplier: 1.15, controlPoints: [{ t: 0.35, perpendicularKm: 1.5 }, { t: 0.72, perpendicularKm: -1.6 }] },
      { id: "long", name: "Jurong green extension", distanceMultiplier: 1.28, controlPoints: [{ t: 0.25, perpendicularKm: 2.2 }, { t: 0.6, perpendicularKm: 1.2 }, { t: 0.8, perpendicularKm: -2.1 }] }
    ]
  }
];
