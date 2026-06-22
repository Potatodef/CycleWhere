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
  station: string;
};

export type ResolvedParticipant = ParticipantDraft & {
  stationResolution: LocationResolution;
  anchor: TransportAnchor;
};

export type RouteSource = "verified-network";

export type RoutingProfile =
  | "official_protected"
  | "official_quiet"
  | "bicycle"
  | "cycling"
  | "walk_discovery";

export type RouteConfidence = "validated" | "aligned" | "heuristic-only";

export type RouteQualitySource = "measured";

export type RouteOrigin = "network-endpoint" | "named-route";

export type RouteMinutesSource = "onemap" | "distance-estimate";

export type RouteFairnessSource = "estimated" | "exact";

export type RouteSectionId =
  | "best-fair-routes"
  | "more-route-options"
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
  searchRank?: number;
  source: RouteSource;
  origin: RouteOrigin;
  profile: RoutingProfile;
  routeName: string;
  endpointName: string;
  endpoint: LatLng;
  endpointAnchor: TransportAnchor;
  geometry: LatLng[];
  graphEdgeIds?: string[];
  distanceKm: number;
  cyclingMinutes: number;
  verifiedCoverage?: number;
  pcnCoverage?: number;
  cyclingPathCoverage?: number;
  mixedTrafficMeters?: number;
  sourceDatasets: string[];
  sourceFeatureIds: string[];
  routeQualityScore?: number | null;
  routeQualitySource: RouteQualitySource;
  overlapSignature: string[];
  officialRouteId?: string;
  officialRouteName?: string;
  officialRouteSurface?: "paved" | "mixed";
  cyclingMinutesSource?: RouteMinutesSource;
};

export type ParticipantRouteTime = {
  participantId: string;
  participantName: string;
  stationName: string;
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
  fairnessSource: RouteFairnessSource;
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

export type RouteSearchRequest = {
  start: {
    label: string;
    point: LatLng;
  };
  departureIso: string;
  participants: Array<{
    id: string;
    name: string;
    station: LatLng;
    anchor: TransportAnchor;
  }>;
};

export type CandidateEvaluation = {
  candidateId: string;
  accepted: boolean;
  reason?: string;
};

export type RouteSearchResult = {
  searchId: string;
  routes: RouteCandidate[];
  zoneStatuses: ZoneDiscoveryStatus[];
  liveDiscoveryStatus: LiveDiscoveryStatus;
  graphVersion: string;
  expiresAt: string;
  nextPageToken: string | null;
};

export type RouteSearchPageResult = Omit<RouteSearchResult, "searchId" | "expiresAt"> & {
  searchId: string;
  expiresAt: string;
};

export type RouteSearchErrorCode =
  | "invalid_meetup"
  | "routing_unavailable"
  | "search_expired";

export type RouteSearchError = {
  error: string;
  code: RouteSearchErrorCode;
};

export type VerifiedNetworkKind = "cycling-path" | "park-connector" | "official-route";

export type VerifiedNetworkSegment = {
  id: string;
  sourceDataset: string;
  sourceFeatureId: string;
  name: string;
  kind: VerifiedNetworkKind;
  verifiedOn: string;
  lengthKm: number;
  geometry: LatLng[];
};

export type VerifiedNetworkCandidatePoint = {
  id: string;
  point: LatLng;
  sourceKinds: VerifiedNetworkKind[];
  nearbyFeatureIds: string[];
};

export type VerifiedNetworkCoveragePoint = {
  point: LatLng;
  kind: VerifiedNetworkKind;
  sourceDataset: string;
  sourceFeatureId: string;
};

export type VerifiedNetworkBusAnchor = {
  id: string;
  name: string;
  point: LatLng;
};

export type VerifiedNamedRoute = {
  id: string;
  name: string;
  kind: "corridor";
  surface: "paved" | "mixed";
  publishedDistanceKm: number;
  sourceDataset: string;
  sourceFeatureIds: string[];
  geometry: LatLng[];
};

export type VerifiedNetworkDatasetInfo = {
  name: string;
  datasetId: string;
  kind: VerifiedNetworkKind;
  verifiedOn: string;
};

export type VerifiedNetworkData = {
  version: string;
  sourcePolicy: string;
  datasets: VerifiedNetworkDatasetInfo[];
  segments: VerifiedNetworkSegment[];
  candidatePoints: VerifiedNetworkCandidatePoint[];
  coveragePoints: VerifiedNetworkCoveragePoint[];
  busAnchors: VerifiedNetworkBusAnchor[];
  namedRoutes: VerifiedNamedRoute[];
};
