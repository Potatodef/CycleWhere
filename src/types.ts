export type ActivityProfile = "cycling";

export type ThemeId = "neutral-ink" | "forest" | "warm-clay";

export type LatLng = {
  lat: number;
  lng: number;
};

export type LocationResolution = {
  query: string;
  label: string;
  point: LatLng;
  confidence: "high" | "medium" | "low";
  source: "onemap" | "fallback";
};

export type TransportMode = "rail" | "bus";

export type TransportAnchor = {
  id: string;
  name: string;
  kind: TransportMode;
  point: LatLng;
  distanceFromHomeKm: number;
  fallbackSuggested: boolean;
  fallbackAnchor?: {
    id: string;
    name: string;
    kind: TransportMode;
    point: LatLng;
    distanceFromHomeKm: number;
  };
};

export type ParticipantDraft = {
  id: string;
  name: string;
  address: string;
};

export type ResolvedParticipant = ParticipantDraft & {
  home: LocationResolution;
  anchor: TransportAnchor;
};

export type PopularityEvidence = {
  label: string;
  url: string;
  reviewedOn: string;
};

export type CorridorSeed = {
  id: string;
  name: string;
  endpointName: string;
  endpoint: LatLng;
  preferredAnchorId: string;
  basePcnCoverage: number;
  baseCyclingPathCoverage: number;
  baseCommonCorridorCoverage: number;
  baseMixedTrafficMeters: number;
  evidence: PopularityEvidence[];
  detours: Array<{
    id: string;
    name: string;
    distanceMultiplier: number;
    controlPoints: Array<{
      t: number;
      perpendicularKm: number;
    }>;
  }>;
};

export type ParticipantRouteTime = {
  participantId: string;
  participantName: string;
  anchorName: string;
  transitMinutes: number;
};

export type FairnessTier = "Excellent" | "Fair" | "Stretched" | "Uneven";

export type RoutePlan = {
  id: string;
  corridorId: string;
  corridorName: string;
  routeName: string;
  endpointName: string;
  endpoint: LatLng;
  geometry: LatLng[];
  distanceKm: number;
  cyclingMinutes: number;
  pcnCoverage: number;
  cyclingPathCoverage: number;
  commonCorridorCoverage: number;
  mixedTrafficMeters: number;
  averageJourneyHomeMinutes: number;
  fairnessSpreadMinutes: number;
  fairnessStdDeviationMinutes: number;
  fairnessTier: FairnessTier;
  participantTimes: ParticipantRouteTime[];
  popularityEvidence: PopularityEvidence[];
  majorityFriendly: boolean;
  overlapSignature: string[];
};

export type PlannedRoutes = {
  primary: RoutePlan[];
  uneven: RoutePlan[];
  computedAt: string;
};

export type GeocodeResponse = {
  results: LocationResolution[];
};

export type TransitTimeQuery = {
  from: LatLng;
  to: LatLng;
  departureIso: string;
  modeHint: TransportMode;
};

export type TransitTimeResult = {
  minutes: number | null;
  source: "onemap" | "estimate";
};

export type TransitTimesResponse = {
  results: TransitTimeResult[];
};
