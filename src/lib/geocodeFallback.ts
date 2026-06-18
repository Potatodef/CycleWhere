import type { LatLng, LocationResolution } from "../types.js";

const knownPlaces: Array<{ pattern: RegExp; label: string; point: LatLng }> = [
  { pattern: /marina|mbfc|shenton/i, label: "Marina Bay", point: { lat: 1.2808, lng: 103.8545 } },
  { pattern: /east coast|marine parade|siglap/i, label: "East Coast", point: { lat: 1.3048, lng: 103.907 } },
  { pattern: /bedok/i, label: "Bedok", point: { lat: 1.3249, lng: 103.9303 } },
  { pattern: /tampines/i, label: "Tampines", point: { lat: 1.3532, lng: 103.944 } },
  { pattern: /pasir ris/i, label: "Pasir Ris", point: { lat: 1.3737, lng: 103.9498 } },
  { pattern: /changi/i, label: "Changi", point: { lat: 1.3572, lng: 103.9877 } },
  { pattern: /bishan/i, label: "Bishan", point: { lat: 1.351, lng: 103.848 } },
  { pattern: /toa payoh/i, label: "Toa Payoh", point: { lat: 1.3329, lng: 103.8477 } },
  { pattern: /ang mo kio|amk/i, label: "Ang Mo Kio", point: { lat: 1.3702, lng: 103.8494 } },
  { pattern: /serangoon/i, label: "Serangoon", point: { lat: 1.3498, lng: 103.8738 } },
  { pattern: /hougang/i, label: "Hougang", point: { lat: 1.3714, lng: 103.893 } },
  { pattern: /sengkang/i, label: "Sengkang", point: { lat: 1.3918, lng: 103.8952 } },
  { pattern: /punggol/i, label: "Punggol", point: { lat: 1.406, lng: 103.9055 } },
  { pattern: /woodlands/i, label: "Woodlands", point: { lat: 1.4362, lng: 103.7862 } },
  { pattern: /yishun/i, label: "Yishun", point: { lat: 1.4291, lng: 103.835 } },
  { pattern: /clementi/i, label: "Clementi", point: { lat: 1.3151, lng: 103.7649 } },
  { pattern: /jurong/i, label: "Jurong East", point: { lat: 1.3332, lng: 103.7422 } },
  { pattern: /buona vista|one-north/i, label: "Buona Vista", point: { lat: 1.3072, lng: 103.7903 } },
  { pattern: /harbourfront|sentosa/i, label: "HarbourFront", point: { lat: 1.2653, lng: 103.8214 } }
];

function hashString(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function fallbackPoint(input: string): LatLng {
  const hash = hashString(input);
  const lat = 1.24 + ((hash % 1800) / 10000);
  const lng = 103.63 + (((hash / 1800) % 3200) / 10000);
  return { lat, lng };
}

export function fallbackResolve(query: string): LocationResolution {
  const known = knownPlaces.find((place) => place.pattern.test(query));
  if (known) {
    return {
      query,
      label: known.label,
      point: known.point,
      confidence: "medium",
      source: "fallback"
    };
  }

  return {
    query,
    label: query.trim() || "Pinned location",
    point: fallbackPoint(query),
    confidence: "low",
    source: "fallback"
  };
}
