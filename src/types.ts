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

export type RouteSource = "curated" | "discovered";

export type RoutingProfile = "cycling" | "walk_discovery";

export type RouteConfidence = "validated" | "aligned" | "novel" | "heuristic-only";

export type RouteQualitySource = "measured" | "inferred" | "unknown";

export type RouteSectionId =
  | "trusted-matches"
  | "best-discovered"
  | "curated-alternatives"
  | "majority-friendly-uneven";

export type LiveDiscoveryStatus = "available" | "partial" | "unavailable";

export type ZoneDiscoveryState = "available" | "partial" | "unavailable" | "error";

export type ZoneDiscoveryStatus = {
  zoneId: string;
  zoneName: string;
  status: ZoneDiscoveryState;
  usedProfile: RoutingProfile | null;
  candidateCount: number;
  reason?: string;
};

export type RouteCandidate = {
  id: string;
  zoneId: string;
  zoneName: string;
  source: RouteSource;
  profile: RoutingProfile;
  corridorId?: string;
  corridorName?: string;
  routeName: string;
  endpointName: string;
  endpoint: LatLng;
  endpointAnchor: TransportAnchor;
  geometry: LatLng[];
  distanceKm: number;
  cyclingMinutes: number;
  pcnCoverage?: number;
  cyclingPathCoverage?: number;
  commonCorridorCoverage?: number;
  mixedTrafficMeters?: number;
  popularityEvidence?: PopularityEvidence[];
  routeQualityScore?: number | null;
  routeQualitySource: RouteQualitySource;
  overlapSignature: string[];
  discoveryDetails?: {
    spineEndpointName: string;
    harvestedIndex: number;
    fromWalkingSpine: boolean;
  };
};

export type ParticipantRouteTime = {
  participantId: string;
  participantName: string;
  anchorName: string;
  transitMinutes: number;
};

export type FairnessTier = "Excellent" | "Fair" | "Stretched" | "Uneven";

export type RoutePlan = RouteCandidate & {
  averageJourneyHomeMinutes: number;
  fairnessSpreadMinutes: number;
  fairnessStdDeviationMinutes: number;
  fairnessTier: FairnessTier;
  participantTimes: ParticipantRouteTime[];
  majorityFriendly: boolean;
  confidence: RouteConfidence;
  matchedCorridorId?: string;
  corridorAgreementScore?: number;
  section: RouteSectionId;
};

export type RouteSection = {
  id: RouteSectionId;
  title: string;
  routes: RoutePlan[];
  bestFairnessRouteId?: string;
};

export type PlannedRoutes = {
  sections: RouteSection[];
  zoneStatuses: ZoneDiscoveryStatus[];
  liveDiscoveryStatus: LiveDiscoveryStatus;
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

export type DiscoverRoutesRequest = {
  start: {
    label: string;
    point: LatLng;
  };
  participants: Array<{
    id: string;
    name: string;
    home: LatLng;
    anchor: TransportAnchor;
  }>;
};

export type DiscoveredRoutesResponse = {
  candidates: RouteCandidate[];
  zoneStatuses: ZoneDiscoveryStatus[];
  liveDiscoveryStatus: LiveDiscoveryStatus;
};
