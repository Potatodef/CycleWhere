import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { railStationSeeds, snapMeetupPointToLand } from "./lib/anchors.js";
import { formatIsoLocal, roundToFiveMinutes } from "./lib/geo.js";
import { filterPlannedRoutes } from "./lib/routeFilters.js";
import { findExactStation, getStationRecommendations } from "./lib/stations.js";
import {
  createRouteSearch,
  geocodeQueries,
  fetchTransitTimes,
  loadRouteSearchPage,
  resolveParticipants
} from "./lib/api.js";
import { buildTransitQueries } from "./lib/planner.js";
import type {
  LiveDiscoveryStatus,
  LocationResolution,
  PlannedRoutes,
  ResolvedParticipant,
  RouteFairnessSource,
  RouteCandidate,
  RoutePlan,
  RouteSection,
  ZoneDiscoveryStatus
} from "./types.js";

const worker = new Worker(new URL("./workers/planner.worker.ts", import.meta.url), {
  type: "module"
});

type WorkerRequest = {
  candidates: RouteCandidate[];
  participants: ResolvedParticipant[];
  startTimeIso: string;
  transitOverrides?: Record<string, number>;
  zoneStatuses?: ZoneDiscoveryStatus[];
  liveDiscoveryStatus?: LiveDiscoveryStatus;
};

type WorkerResponse =
  | { ok: true; plannedRoutes: PlannedRoutes }
  | { ok: false; error: string };

type PlanningSession = WorkerRequest & {
  graphVersion: string;
  nextPageToken: string | null;
  searchId: string;
  expiresAt: string;
};

const RouteMap = lazy(async () => {
  const module = await import("./components/RouteMap.js");
  return { default: module.RouteMap };
});

type ParticipantInput = {
  id: string;
  name: string;
  station: string;
  colorIndex: number;
};

const participantPalette = [
  {
    accent: "oklch(48% 0.14 158)",
    accentStrong: "oklch(42% 0.16 158)",
    surface: "oklch(97% 0.010 158)",
    border: "oklch(89% 0.018 158)"
  },
  {
    accent: "oklch(55% 0.12 280)",
    accentStrong: "oklch(47% 0.14 280)",
    surface: "oklch(97% 0.008 280)",
    border: "oklch(89% 0.014 280)"
  },
  {
    accent: "oklch(58% 0.11 55)",
    accentStrong: "oklch(50% 0.13 55)",
    surface: "oklch(97% 0.008 55)",
    border: "oklch(90% 0.014 55)"
  },
  {
    accent: "oklch(60% 0.12 110)",
    accentStrong: "oklch(49% 0.14 110)",
    surface: "oklch(97% 0.008 110)",
    border: "oklch(90% 0.014 110)"
  },
  {
    accent: "oklch(56% 0.14 15)",
    accentStrong: "oklch(46% 0.16 15)",
    surface: "oklch(97% 0.008 15)",
    border: "oklch(90% 0.014 15)"
  },
  {
    accent: "oklch(53% 0.12 230)",
    accentStrong: "oklch(44% 0.15 230)",
    surface: "oklch(97% 0.008 230)",
    border: "oklch(89% 0.014 230)"
  },
  {
    accent: "oklch(62% 0.11 345)",
    accentStrong: "oklch(52% 0.13 345)",
    surface: "oklch(97% 0.008 345)",
    border: "oklch(90% 0.014 345)"
  },
  {
    accent: "oklch(63% 0.13 200)",
    accentStrong: "oklch(51% 0.15 200)",
    surface: "oklch(97% 0.008 200)",
    border: "oklch(89% 0.014 200)"
  },
  {
    accent: "oklch(62% 0.10 85)",
    accentStrong: "oklch(52% 0.12 85)",
    surface: "oklch(97% 0.008 85)",
    border: "oklch(90% 0.014 85)"
  },
  {
    accent: "oklch(57% 0.09 25)",
    accentStrong: "oklch(48% 0.11 25)",
    surface: "oklch(97% 0.008 25)",
    border: "oklch(90% 0.014 25)"
  }
];

const exampleParticipants: ParticipantInput[] = [
  { id: "1", name: "Ariel", station: "Bedok MRT", colorIndex: 0 },
  { id: "2", name: "Ben", station: "Tampines MRT", colorIndex: 1 },
  { id: "3", name: "Charis", station: "Paya Lebar MRT", colorIndex: 2 },
  { id: "4", name: "Deepa", station: "Punggol MRT", colorIndex: 3 }
];

const initialParticipants: ParticipantInput[] = [
  { id: "starter-1", name: "", station: "", colorIndex: 0 },
  { id: "starter-2", name: "", station: "", colorIndex: 1 }
];

const distanceFilterOptions = [0, 5, 10, 15, 20];
const spreadFilterOptions = [0, 10, 20, 30, 45];

function formatCoverage(value?: number) {
  return value === undefined ? "n/a" : `${Math.round(value * 100)}%`;
}

function hasCoverageDetails(route: RoutePlan) {
  return (
    route.verifiedCoverage !== undefined ||
    route.pcnCoverage !== undefined ||
    route.cyclingPathCoverage !== undefined
  );
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return `${hours}h ${minutes}m`;
}

function formatDepartureSummary(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function buildGoogleMapsRouteUrl(
  start: { lat: number; lng: number },
  route: RoutePlan
) {
  if (route.origin === "named-route") {
    return null;
  }
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${start.lat},${start.lng}`);
  url.searchParams.set("destination", `${route.endpoint.lat},${route.endpoint.lng}`);
  url.searchParams.set("travelmode", "bicycling");
  return url.toString();
}

function exactCandidateLimit(participantCount: number) {
  return Math.max(1, Math.min(8, Math.floor(40 / Math.max(participantCount, 1))));
}

function geolocationErrorMessage(error?: GeolocationPositionError) {
  switch (error?.code) {
    case 1:
      return "Location permission was denied. Allow location access in the browser and try again.";
    case 2:
      return "Current location is unavailable on this device right now. Try again in a moment.";
    case 3:
      return "Current location took too long to load. Try again.";
    default:
      return "Current location could not be read. Check location permission and try again.";
  }
}

function nextColorIndex(participants: ParticipantInput[]) {
  const used = new Set(participants.map((participant) => participant.colorIndex));
  for (let index = 0; index < participantPalette.length; index += 1) {
    if (!used.has(index)) {
      return index;
    }
  }

  return participants.length % participantPalette.length;
}

function fallbackParticipantName(participant: { name: string }, index: number) {
  return participant.name.trim() || `Rider ${index + 1}`;
}

function buildParticipantDrafts(participants: ParticipantInput[]) {
  const names = participants.map((participant, index) => fallbackParticipantName(participant, index));
  const duplicateCounts = names.reduce<Record<string, number>>((counts, name) => {
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});

  return participants.map((participant, index) => ({
    id: participant.id,
    name: duplicateCounts[names[index] ?? ""] > 1 ? `${names[index]} (${index + 1})` : names[index] ?? `Rider ${index + 1}`,
    station: participant.station
  }));
}

function hasReliableMeetupResolution(resolution: LocationResolution | null) {
  return Boolean(resolution && resolution.confidence !== "low");
}

function getApiBase() {
  const fromImportMeta =
    (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";
  const fromWindow = (window as Window & {
    __CYCLEWHERE_CONFIG__?: { apiBase?: string };
  }).__CYCLEWHERE_CONFIG__?.apiBase;

  return fromImportMeta || fromWindow || "";
}

function routeBadgeClass(route: RoutePlan) {
  switch (route.fairnessTier) {
    case "Excellent":
      return "tier tier-excellent";
    case "Fair":
      return "tier tier-fair";
    case "Stretched":
      return "tier tier-stretched";
    default:
      return "tier tier-uneven";
  }
}

function routeDirectionLabel(route: RoutePlan, startLabel?: string) {
  return startLabel ? `${startLabel} to ${route.endpointName}` : route.endpointName;
}

function AppSectionLabel({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function RouteCard({
  route,
  startLabel,
  bestFairnessRouteId,
  selectedRouteId,
  expanded,
  onSelect,
  onToggleDetails
}: {
  route: RoutePlan;
  startLabel?: string;
  bestFairnessRouteId?: string;
  selectedRouteId: string | null;
  expanded: boolean;
  onSelect: (routeId: string) => void;
  onToggleDetails: (routeId: string) => void;
}) {
  return (
    <article
      className={`route-card ${selectedRouteId === route.id ? "selected" : ""}`}
      role="button"
      aria-pressed={selectedRouteId === route.id}
      onClick={() => onSelect(route.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(route.id);
        }
      }}
      tabIndex={0}
    >
      <div className="route-card-head">
        <div>
          <div className="route-title-row">
            <h3>{route.endpointName}</h3>
            <span className={routeBadgeClass(route)}>{route.fairnessTier}</span>
          </div>
          <p>{routeDirectionLabel(route, startLabel)}</p>
          <div className="chip-row">
            {bestFairnessRouteId === route.id ? <span className="chip">Best overall in section</span> : null}
            <span className="chip">{route.fairnessSource === "exact" ? "Exact fairness" : "Estimated fairness"}</span>
            {route.origin === "named-route" ? <span className="chip">Named official route</span> : null}
            {route.officialRouteSurface === "mixed" ? <span className="chip">Mixed surface</span> : null}
          </div>
        </div>
        <div className="metric-cluster">
          <strong>{route.distanceKm.toFixed(1)} km</strong>
          <span>{formatMinutes(route.cyclingMinutes)}</span>
        </div>
      </div>

      <div className="metric-grid">
        <div>
          <span>Average ride home</span>
          <strong>{formatMinutes(route.averageJourneyHomeMinutes)}</strong>
        </div>
        <div>
          <span>Group spread</span>
          <strong>{route.fairnessSpreadMinutes} min</strong>
        </div>
        <div>
          <span>Std deviation</span>
          <strong>{route.fairnessStdDeviationMinutes.toFixed(1)} min</strong>
        </div>
        <div>
          <span>Mixed traffic</span>
          <strong>{route.mixedTrafficMeters !== undefined ? `${route.mixedTrafficMeters} m` : "n/a"}</strong>
        </div>
      </div>

      {hasCoverageDetails(route) ? (
        <div className="chip-row">
          {route.verifiedCoverage !== undefined ? (
            <span className="chip">Verified network {formatCoverage(route.verifiedCoverage)}</span>
          ) : null}
          {route.pcnCoverage !== undefined ? <span className="chip">PCN {formatCoverage(route.pcnCoverage)}</span> : null}
          {route.cyclingPathCoverage !== undefined ? (
            <span className="chip">Cycling path {formatCoverage(route.cyclingPathCoverage)}</span>
          ) : null}
        </div>
      ) : null}

      <div
        className="route-details"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="details-toggle"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleDetails(route.id);
          }}
        >
          {expanded ? "Hide rider breakdown" : "Show rider breakdown"}
        </button>
        {expanded ? (
          <>
            <div className="details-block">
              {route.participantTimes.map((participantTime) => (
                <div key={participantTime.participantId} className="participant-time-row">
                  <span>
                    {participantTime.participantName} via {participantTime.stationName}
                  </span>
                  <strong>{formatMinutes(participantTime.transitMinutes)}</strong>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}

export function App() {
  const [startQuery, setStartQuery] = useState("Marina Bay");
  const [scheduledStartTime, setScheduledStartTime] = useState(formatIsoLocal(roundToFiveMinutes()));
  const [hasCustomDepartureTime, setHasCustomDepartureTime] = useState(false);
  const [showDeparturePicker, setShowDeparturePicker] = useState(false);
  const [isLocatingStart, setIsLocatingStart] = useState(false);
  const [participants, setParticipants] = useState(initialParticipants);
  const [invalidStartQuery, setInvalidStartQuery] = useState(false);
  const [startFieldMessage, setStartFieldMessage] = useState<string | null>(null);
  const [activeStationFieldId, setActiveStationFieldId] = useState<string | null>(null);
  const [invalidStationIds, setInvalidStationIds] = useState<string[]>([]);
  const [resolvedStart, setResolvedStart] = useState<{
    label: string;
    point: { lat: number; lng: number };
    source: string;
  } | null>(null);
  const [resolvedParticipants, setResolvedParticipants] = useState<ResolvedParticipant[]>([]);
  const [results, setResults] = useState<PlannedRoutes | null>(null);
  const [planningSession, setPlanningSession] = useState<PlanningSession | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [expandedRouteIds, setExpandedRouteIds] = useState<string[]>([]);
  const [showRouteFilters, setShowRouteFilters] = useState(false);
  const [minimumDistanceKm, setMinimumDistanceKm] = useState(0);
  const [maximumFairnessSpreadMinutes, setMaximumFairnessSpreadMinutes] = useState(0);
  const [status, setStatus] = useState<"idle" | "planning">("idle");
  const [message, setMessage] = useState(
    "Pick one meetup point and each rider's MRT station, then compare route endings by how fair the ride home looks."
  );
  const workerPromiseRef = useRef<{
    resolve: (value: PlannedRoutes) => void;
    reject: (reason?: unknown) => void;
  } | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const filterDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = "neutral-ink";
  }, []);

  useEffect(() => {
    const dialog = filterDialogRef.current;
    if (showRouteFilters && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [showRouteFilters]);

  function closeRouteFilters() {
    filterDialogRef.current?.close();
    setShowRouteFilters(false);
    filterButtonRef.current?.focus();
  }

  useEffect(() => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.ok) {
        workerPromiseRef.current?.resolve(event.data.plannedRoutes);
      } else {
        workerPromiseRef.current?.reject(new Error(event.data.error));
      }
      workerPromiseRef.current = null;
    };

    worker.onerror = () => {
      workerPromiseRef.current?.reject(new Error("Route planning failed before results were ready."));
      workerPromiseRef.current = null;
    };

    worker.onmessageerror = () => {
      workerPromiseRef.current?.reject(new Error("Route planning returned an unreadable result."));
      workerPromiseRef.current = null;
    };
  }, []);

  const participantStyles = useMemo(
    () =>
      Object.fromEntries(
        participants.map((participant) => [participant.id, participantPalette[participant.colorIndex]])
      ),
    [participants]
  );

  const filteredResults = useMemo(
    () =>
      results
        ? filterPlannedRoutes(results, {
            minimumDistanceKm,
            maximumFairnessSpreadMinutes
          })
        : null,
    [results, minimumDistanceKm, maximumFairnessSpreadMinutes]
  );

  const allRoutes = useMemo(
    () => filteredResults?.sections.flatMap((section) => section.routes) ?? [],
    [filteredResults]
  );

  const totalRouteCount = useMemo(
    () => results?.sections.reduce((count, section) => count + section.routes.length, 0) ?? 0,
    [results]
  );

  const previewParticipants = useMemo(
    () =>
      participants.flatMap((participant) => {
        const station = findExactStation(participant.station);
        if (!station) {
          return [];
        }

        return [
          {
            ...participant,
            stationResolution: {
              query: participant.station,
              label: station.name,
              point: station.point,
              confidence: "high" as const,
              source: "fallback" as const
            },
            anchor: {
              id: station.id,
              name: station.name,
              kind: "rail" as const,
              point: station.point,
              distanceFromHomeKm: 0,
              fallbackSuggested: false
            }
          } satisfies ResolvedParticipant
        ];
      }),
    [participants]
  );

  const selectedRoute = useMemo(() => {
    if (!selectedRouteId) {
      return allRoutes[0] ?? null;
    }
    return allRoutes.find((route) => route.id === selectedRouteId) ?? allRoutes[0] ?? null;
  }, [allRoutes, selectedRouteId]);

  const hasPreviewMapData = Boolean(resolvedStart || previewParticipants.length > 0 || selectedRoute);
  const allRouteCount = allRoutes.length;
  const googleMapsRouteUrl =
    resolvedStart && selectedRoute ? buildGoogleMapsRouteUrl(resolvedStart.point, selectedRoute) : null;
  const hasActiveRouteFilters = minimumDistanceKm > 0 || maximumFairnessSpreadMinutes > 0;
  const routeFilterSummary = [
    minimumDistanceKm > 0 ? `${minimumDistanceKm} km+` : null,
    maximumFairnessSpreadMinutes > 0 ? `Spread <= ${maximumFairnessSpreadMinutes} min` : null
  ]
    .filter(Boolean)
    .join(" · ");

  function clearResolvedState() {
    setResolvedStart(null);
    setResolvedParticipants([]);
    setResults(null);
    setPlanningSession(null);
    setSelectedRouteId(null);
    setExpandedRouteIds([]);
  }

  function resetDepartureTime() {
    setScheduledStartTime(formatIsoLocal(roundToFiveMinutes()));
    setHasCustomDepartureTime(false);
    setShowDeparturePicker(false);
  }

  function resetPlannedState() {
    setResolvedParticipants([]);
    setResults(null);
    setPlanningSession(null);
    setSelectedRouteId(null);
    setExpandedRouteIds([]);
  }

  function updateParticipant(id: string, key: "name" | "station", value: string) {
    if (key === "station") {
      setInvalidStationIds((current) => current.filter((currentId) => currentId !== id));
    }
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, [key]: value } : participant
      )
    );
    clearResolvedState();
  }

  function addParticipant() {
    setParticipants((current) => {
      if (current.length >= 10) {
        return current;
      }
      return [
        ...current,
        {
          id: crypto.randomUUID(),
          name: "",
          station: "",
          colorIndex: nextColorIndex(current)
        }
      ];
    });
    clearResolvedState();
  }

  function removeParticipant(id: string) {
    setParticipants((current) => {
      if (current.length <= 2) {
        return current;
      }
      return current.filter((participant) => participant.id !== id);
    });
    clearResolvedState();
  }

  async function resolveInputs(start: LocationResolution) {
    const people = await resolveParticipants(buildParticipantDrafts(participants));
    const resolved = {
      start: {
        label: start.label,
        point: start.point,
        source: start.source
      },
      participants: people
    };

    setResolvedStart(resolved.start);
    setResolvedParticipants(resolved.participants);
    return resolved;
  }

  async function resolveParticipantsWithKnownStart() {
    const start = resolvedStart;
    if (!start) {
      throw new Error("Resolved start is missing.");
    }

    const people = await resolveParticipants(buildParticipantDrafts(participants));

    setResolvedParticipants(people);
    return {
      start,
      participants: people
    };
  }

  async function runPlanner(request: WorkerRequest) {
    return new Promise<PlannedRoutes>((resolve, reject) => {
      workerPromiseRef.current = { resolve, reject };
      worker.postMessage(request satisfies WorkerRequest);
    });
  }

  function pickExactCandidateIds(routes: PlannedRoutes, limit: number) {
    const ids: string[] = [];
    for (const route of routes.sections.flatMap((section) => section.routes)) {
      if (route.fairnessSource === "exact") {
        continue;
      }
      if (ids.includes(route.id)) {
        continue;
      }
      ids.push(route.id);
      if (ids.length >= limit) {
        break;
      }
    }
    return ids;
  }

  async function rerankSession(session: PlanningSession, forceExactRouteIds: string[] = []) {
    const estimatedPlan = await runPlanner(session);
    const limit = exactCandidateLimit(session.participants.length);
    const exactIds = Array.from(
      new Set(forceExactRouteIds.concat(pickExactCandidateIds(estimatedPlan, limit)))
    ).slice(0, limit);

    if (!getApiBase() || exactIds.length === 0) {
      return {
        session,
        plannedRoutes: estimatedPlan
      };
    }

    const exactCandidates = session.candidates.filter((candidate) => exactIds.includes(candidate.id));
    const transitQueryBundle = buildTransitQueries({
      candidates: exactCandidates,
      participants: session.participants,
      startTimeIso: session.startTimeIso
    }).filter((item) => session.transitOverrides?.[item.key] === undefined);

    if (transitQueryBundle.length === 0) {
      return {
        session,
        plannedRoutes: estimatedPlan
      };
    }

    const transitResults = await fetchTransitTimes(transitQueryBundle.map((item) => item.query));
    const nextOverrides = {
      ...(session.transitOverrides ?? {})
    };

    transitResults.forEach((result, index) => {
      const key = transitQueryBundle[index]?.key;
      if (key && typeof result.minutes === "number") {
        nextOverrides[key] = result.minutes;
      }
    });

    const nextSession = {
      ...session,
      transitOverrides: nextOverrides
    };

    return {
      session: nextSession,
      plannedRoutes: await runPlanner(nextSession)
    };
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setMessage("Current location is unavailable in this browser.");
      return;
    }

    setIsLocatingStart(true);
    setMessage("Checking your current location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const landed = snapMeetupPointToLand(
          {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          },
          "Current location"
        );

        setStartQuery(landed.label);
        setInvalidStartQuery(false);
        setStartFieldMessage(
          landed.snapped ? "Current location looked offshore, so it was snapped to the nearest land anchor." : null
        );
        setResolvedStart({
          label: landed.label,
          point: landed.point,
          source: "fallback"
        });
        resetPlannedState();
        setMessage(
          landed.snapped ? `Using ${landed.label} instead of an offshore point.` : "Using your current location as the meetup point."
        );
        setIsLocatingStart(false);
      },
      (error) => {
        setMessage(geolocationErrorMessage(error));
        setIsLocatingStart(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }

  async function handlePlan() {
    const trimmedStartQuery = startQuery.trim();
    const [startResolution] = trimmedStartQuery && !resolvedStart
      ? await geocodeQueries([trimmedStartQuery])
      : [null];
    const startMoment = hasCustomDepartureTime ? scheduledStartTime : formatIsoLocal(roundToFiveMinutes());
    const startDate = new Date(startMoment);
    const unresolvedStations = participants
      .filter((participant) => !findExactStation(participant.station))
      .map((participant) => participant.id);
    const hasInvalidMeetup = !resolvedStart && (!trimmedStartQuery || !hasReliableMeetupResolution(startResolution));
    const hasPastDepartureTime =
      hasCustomDepartureTime &&
      (Number.isNaN(startDate.getTime()) || startDate.getTime() < roundToFiveMinutes().getTime());

    setInvalidStartQuery(hasInvalidMeetup);
    setStartFieldMessage(
      hasInvalidMeetup ? "Use a real meetup point that resolves to an actual place in Singapore." : null
    );
    setInvalidStationIds(unresolvedStations);

    if (hasInvalidMeetup || unresolvedStations.length > 0 || hasPastDepartureTime) {
      setActiveStationFieldId(unresolvedStations[0] ?? null);
      setMessage(
        hasPastDepartureTime
          ? "Pick a departure time that is now or later before planning."
          : hasInvalidMeetup && unresolvedStations.length > 0
          ? "Fix the meetup point and every rider's MRT/LRT station before planning."
          : hasInvalidMeetup
            ? "Fix the meetup point before planning any routes."
            : "Pick a valid MRT/LRT station for every rider before planning any routes."
      );
      return;
    }

    setStatus("planning");
    setMessage("Checking verified Singapore cycling routes, then ranking them by fairness and route quality.");

    try {
      const prepareResolved =
        resolvedStart && resolvedParticipants.length === participants.length
          ? Promise.resolve({ start: resolvedStart, participants: resolvedParticipants })
          : resolvedStart
            ? resolveParticipantsWithKnownStart()
            : resolveInputs(startResolution!);
      const resolved = await prepareResolved;
      const planningStartIso = new Date(startMoment).toISOString();
      const discovered = await createRouteSearch({
        start: resolved.start,
        departureIso: planningStartIso,
        participants: resolved.participants.map((participant) => ({
          id: participant.id,
          name: participant.name,
          station: participant.stationResolution.point,
          anchor: participant.anchor
        }))
      });
      const initialSession = {
        candidates: discovered.routes,
        participants: resolved.participants,
        startTimeIso: planningStartIso,
        transitOverrides: {},
        zoneStatuses: discovered.zoneStatuses,
        liveDiscoveryStatus: discovered.liveDiscoveryStatus,
        graphVersion: discovered.graphVersion,
        nextPageToken: discovered.nextPageToken,
        searchId: discovered.searchId,
        expiresAt: discovered.expiresAt
      } satisfies PlanningSession;
      const { session, plannedRoutes } = await rerankSession(initialSession);

      setPlanningSession(session);
      setResults(plannedRoutes);
      setSelectedRouteId(plannedRoutes.sections[0]?.routes[0]?.id ?? null);
      setExpandedRouteIds([]);
      setStatus("idle");
      setMessage(
        plannedRoutes.sections.length === 0
          ? "No verified routes were available for that meetup point right now. Try another start or try again."
          : plannedRoutes.liveDiscoveryStatus === "available"
            ? "Verified route options ready. Compare the fairest official-network endings."
            : plannedRoutes.liveDiscoveryStatus === "partial"
              ? "Partial verified results ready. Some official-network candidates could not be routed right now."
              : "Verified route discovery is unavailable right now."
      );
    } catch (error) {
      workerPromiseRef.current = null;
      setStatus("idle");
      setPlanningSession(null);
      setResults(null);
      setSelectedRouteId(null);
      setExpandedRouteIds([]);
      setMessage(
        (error as { code?: string })?.code === "invalid_meetup"
          ? "That meetup point cannot safely connect to the cycling network. Pick another nearby location."
          : (error as { code?: string })?.code === "routing_unavailable"
            ? "The cycling graph is unavailable right now. Try again shortly."
            : "Route planning hit an unexpected error. Try the same inputs again."
      );
    }
  }

  async function handleLoadMore() {
    if (!planningSession?.nextPageToken) {
      return;
    }

    setStatus("planning");
    setMessage("Loading more official route candidates.");

    try {
      const discovered = await loadRouteSearchPage(planningSession.nextPageToken);
      const mergedCandidates = [...planningSession.candidates];
      for (const candidate of discovered.routes) {
        if (!mergedCandidates.some((existing) => existing.id === candidate.id)) {
          mergedCandidates.push(candidate);
        }
      }

      const nextSession = {
        ...planningSession,
        candidates: mergedCandidates,
        zoneStatuses: discovered.zoneStatuses,
        liveDiscoveryStatus: discovered.liveDiscoveryStatus,
        nextPageToken: discovered.nextPageToken
      } satisfies PlanningSession;
      const reranked = await rerankSession(nextSession);

      setPlanningSession(reranked.session);
      setResults(reranked.plannedRoutes);
      setStatus("idle");
      setMessage("Loaded more official route options.");
    } catch (error) {
      setStatus("idle");
      setMessage(
        (error as { code?: string })?.code === "search_expired"
          ? "This route search expired. Plan again to refresh the results."
          : "Loading more routes failed. Try again."
      );
    }
  }

  async function handleSelectRoute(routeId: string) {
    setSelectedRouteId(routeId);

    if (!results || !planningSession || !getApiBase()) {
      return;
    }

    const selected = results.sections
      .flatMap((section) => section.routes)
      .find((route) => route.id === routeId);

    if (!selected || selected.fairnessSource === "exact") {
      return;
    }

    setStatus("planning");
    setMessage("Checking exact ride-home times for the selected route.");

    try {
      const reranked = await rerankSession(planningSession, [routeId]);
      setPlanningSession(reranked.session);
      setResults(reranked.plannedRoutes);
      setSelectedRouteId(routeId);
      setStatus("idle");
      setMessage("Selected route refreshed with exact ride-home times.");
    } catch {
      setStatus("idle");
      setMessage("Could not refresh exact ride-home times for that route.");
    }
  }

  function loadExample() {
    setStartQuery("Marina Bay");
    setScheduledStartTime(formatIsoLocal(roundToFiveMinutes()));
    setHasCustomDepartureTime(false);
    setShowDeparturePicker(false);
    setParticipants(exampleParticipants.map((participant) => ({ ...participant })));
    setInvalidStartQuery(false);
    setStartFieldMessage(null);
    setActiveStationFieldId(null);
    setInvalidStationIds([]);
    clearResolvedState();
    setMessage("Loaded a sample group with MRT-based inputs so you can test the mobile flow quickly.");
  }

  function toggleRouteDetails(routeId: string) {
    setExpandedRouteIds((current) =>
      current.includes(routeId)
        ? current.filter((currentId) => currentId !== routeId)
        : [...current, routeId]
    );
  }

  function resetRouteFilters() {
    setMinimumDistanceKm(0);
    setMaximumFairnessSpreadMinutes(0);
  }

  return (
    <>
      <nav className="top-nav">
        <div className="top-nav-brand">
          <svg width="26" height="26" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect width="40" height="40" rx="10" fill="oklch(38% 0.13 158)" />
            <circle cx="13" cy="24" r="6" stroke="white" strokeWidth="1.5" fill="none" />
            <circle cx="27" cy="24" r="6" stroke="white" strokeWidth="1.5" fill="none" />
            <path
              d="M13 24 L18 14 L23 14"
              stroke="oklch(82% 0.14 85)"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M23 14 L27 24 L20 24"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="18" cy="14" r="1.3" fill="oklch(82% 0.14 85)" />
          </svg>
          <span>CycleWhere</span>
        </div>
        <div className="top-nav-status">{message}</div>
      </nav>

      <div className="app-shell">
        <div className="bg-orb bg-orb-one" />
        <div className="bg-orb bg-orb-two" />

        <header className="intro-banner">
          <span className="eyebrow">Singapore group route planner</span>
          <h1>Find a cycling route that still leaves the ride home feeling fair.</h1>
          <p>
            Start from one meetup point, choose each rider&apos;s MRT station, and compare route endings by public-transport time spread.
          </p>
          <div className="intro-chip-row">
            <span className="chip">2 to 10 riders</span>
            <span className="chip">MRT-first inputs</span>
            <span className="chip">Mobile-friendly cards</span>
          </div>
        </header>

        <main className="layout-grid">
          <section className="panel panel-form">
            <AppSectionLabel
              eyebrow="Plan"
              title="Meetup, riders, and timing"
              description="Departure defaults to now. Open the calendar only when you want a later start."
            />

            <div className="start-card">
              <div className="start-card-copy">
                <span className="start-card-kicker">Start location</span>
                <strong>Choose the shared meetup point first.</strong>
                <p>This is where the ride begins before everyone heads home on their own route.</p>
              </div>
              <label className="field">
                <span>Meetup point</span>
                <div className="field-inline">
                  <input
                    className={invalidStartQuery ? "invalid-input" : undefined}
                    aria-invalid={invalidStartQuery}
                    value={startQuery}
                    onChange={(event) => {
                      setInvalidStartQuery(false);
                      setStartFieldMessage(null);
                      setStartQuery(event.target.value);
                      clearResolvedState();
                    }}
                    placeholder="Marina Bay MRT"
                  />
                  <button
                    type="button"
                    className="secondary-button field-inline-button"
                    onClick={useCurrentLocation}
                    disabled={isLocatingStart}
                  >
                    {isLocatingStart ? "Locating..." : "Use current location"}
                  </button>
                </div>
                {startFieldMessage ? <span className="field-error">{startFieldMessage}</span> : null}
              </label>
              <div className="start-card-foot">
                <span className="time-chip">Used for every route option</span>
                <span>Try a station, park, or landmark the whole group can meet at.</span>
              </div>
            </div>

            <div className="time-card">
              <div className="time-card-copy">
                <strong>Planned start time</strong>
                <div className="time-card-status">
                  <span className="time-chip">{hasCustomDepartureTime ? formatDepartureSummary(scheduledStartTime) : "Now"}</span>
                  <span>
                    {hasCustomDepartureTime
                      ? "Custom departure selected."
                      : "It uses the current rounded time until you pick a later one."}
                  </span>
                </div>
              </div>
              <div className="time-card-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (!showDeparturePicker && !hasCustomDepartureTime) {
                      setScheduledStartTime(formatIsoLocal(roundToFiveMinutes()));
                    }
                    setShowDeparturePicker((current) => !current);
                  }}
                >
                  {showDeparturePicker ? "Hide calendar" : hasCustomDepartureTime ? "Change time" : "Pick later time"}
                </button>
                {hasCustomDepartureTime ? (
                  <button type="button" className="ghost-button" onClick={resetDepartureTime}>
                    Use now
                  </button>
                ) : null}
              </div>
              {showDeparturePicker ? (
                <label className="field scheduled-time-field">
                  <span>Choose a later departure</span>
                  <input
                    type="datetime-local"
                    value={scheduledStartTime}
                    min={formatIsoLocal(roundToFiveMinutes())}
                    step={300}
                    onChange={(event) => {
                      setScheduledStartTime(event.target.value);
                      setHasCustomDepartureTime(true);
                    }}
                  />
                </label>
              ) : null}
            </div>

            <div className="participants-header">
              <div>
                <h3>Riders</h3>
                <p>Enter each person&apos;s name and the MRT station they usually say they stay near.</p>
              </div>
              <button type="button" className="ghost-button" onClick={loadExample}>
                Load example
              </button>
            </div>

            <div className="participant-list">
              {participants.map((participant, index) => {
                const colors = participantStyles[participant.id];

                return (
                  <div
                    className="participant-card"
                    key={participant.id}
                    style={
                      {
                        "--participant-accent": colors.accent,
                        "--participant-accent-strong": colors.accentStrong,
                        "--participant-surface": colors.surface,
                        "--participant-border": colors.border
                      } as CSSProperties
                    }
                  >
                    <div className="participant-card-top">
                      <div className="participant-avatar">{participant.name ? participant.name[0].toUpperCase() : index + 1}</div>
                      <div>
                        <strong>Rider {index + 1}</strong>
                      </div>
                      {participants.length > 2 ? (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => removeParticipant(participant.id)}
                          aria-label={`Remove rider ${index + 1}`}
                        >
                          &times;
                        </button>
                      ) : null}
                    </div>

                    <div className="participant-card-fields">
                      <label className="field compact-field">
                        <span>Name</span>
                        <input
                          maxLength={40}
                          value={participant.name}
                          onChange={(event) => updateParticipant(participant.id, "name", event.target.value)}
                          placeholder={`Rider ${index + 1}`}
                        />
                      </label>
                      <label className="field compact-field">
                        <span>MRT station</span>
                        <div
                          className="field-with-suggestions"
                          onBlur={(event) => {
                            if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                              return;
                            }
                            setActiveStationFieldId((current) =>
                              current === participant.id ? null : current
                            );
                          }}
                        >
                          <input
                            maxLength={60}
                            className={invalidStationIds.includes(participant.id) ? "invalid-input" : undefined}
                            aria-invalid={invalidStationIds.includes(participant.id)}
                            value={participant.station}
                            onFocus={() => setActiveStationFieldId(participant.id)}
                            onChange={(event) => {
                              updateParticipant(participant.id, "station", event.target.value);
                              setActiveStationFieldId(participant.id);
                            }}
                            placeholder="Bedok MRT"
                          />
                          {invalidStationIds.includes(participant.id) ? (
                            <span className="field-error">Pick one MRT/LRT station from the suggested list.</span>
                          ) : null}
                          {activeStationFieldId === participant.id ? (
                            <div className="station-suggestions" aria-label={`Suggested stations for rider ${index + 1}`}>
                              {getStationRecommendations(participant.station).map((stationName) => (
                                <button
                                  key={stationName}
                                  type="button"
                                  className={`station-suggestion ${stationName === findExactStation(participant.station)?.name ? "selected" : ""}`}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => {
                                    updateParticipant(participant.id, "station", stationName);
                                    setActiveStationFieldId(null);
                                    setMessage(`${participant.name || `Rider ${index + 1}`} pinned to ${stationName}.`);
                                  }}
                                >
                                  <span>{stationName}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="action-row">
              <button
                type="button"
                className="secondary-button"
                onClick={addParticipant}
                disabled={participants.length >= 10}
              >
                Add rider
              </button>
              <button
                type="button"
                className="primary-button dark"
                onClick={handlePlan}
                disabled={status !== "idle"}
              >
                {status === "planning" ? "Planning..." : "Plan routes"}
              </button>
            </div>

            <div className="note-box">
              <strong>Fairness first.</strong>
              <span>
                Routes stay in fairness bands. Within each band, a shorter average journey home ranks first,
                followed by the difference between the longest and shortest trips home.
              </span>
            </div>
          </section>

          <section className="panel panel-map">
            <AppSectionLabel
              eyebrow="Preview"
              title="Start, riders, and selected route"
              description="The start and finish markers stand apart. Each rider marker uses the same color as that rider&apos;s input card."
            />

            {hasPreviewMapData ? (
              <Suspense
                fallback={
                  <div className="map-shell map-fallback map-loading" aria-label="Route preview loading">
                    <div className="map-fallback-copy">
                      <strong>Loading route preview</strong>
                      <span>The route cards are ready. The map will follow in a moment.</span>
                    </div>
                  </div>
                }
              >
                <RouteMap
                  start={resolvedStart}
                  participants={previewParticipants}
                  participantMarkerColors={Object.fromEntries(
                    Object.entries(participantStyles).map(([id, value]) => [id, value.accentStrong])
                  )}
                  selectedRoute={selectedRoute}
                  mapStyle="osm-bright"
                />
              </Suspense>
            ) : (
              <div className="map-shell map-fallback" aria-label="Route preview waiting">
                <div className="map-fallback-copy">
                  <strong>Map preview appears after you plan</strong>
                  <span>
                    Pick the meetup point and riders first, then the route preview loads with the
                    selected option.
                  </span>
                </div>
              </div>
            )}

            <div className="map-caption">
              <span>
                {resolvedStart
                  ? `Start pinned at ${resolvedStart.label}.`
                  : "Start point will pin once planning resolves the meetup location."}
              </span>
              <span>Map uses a clear street-style base with road and place labels.</span>
              <span>
                {getApiBase()
                  ? "Using live route and transit services."
                  : "Using local fallback estimates until live route services are connected."}
              </span>
              {googleMapsRouteUrl ? (
                <a href={googleMapsRouteUrl} target="_blank" rel="noreferrer" className="map-link">
                  Open selected route in Google Maps
                </a>
              ) : null}
            </div>
          </section>

          <section className="panel panel-results">
            <AppSectionLabel
              eyebrow="Results"
              title={`Route cards${allRouteCount ? ` (${allRouteCount})` : totalRouteCount ? ` (${totalRouteCount})` : ""}`}
              description="The most balanced route options stay near the top, with a few extra choices underneath."
            />

            {results ? (
              <>
                <div className="results-toolbar">
                  <button
                    ref={filterButtonRef}
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowRouteFilters(true)}
                  >
                    Filter routes
                  </button>
                  <div className="results-toolbar-copy">
                    <strong>{allRouteCount} shown</strong>
                    <span>{hasActiveRouteFilters ? routeFilterSummary : "Showing every route option."}</span>
                  </div>
                </div>

                {totalRouteCount === 0 ? (
                  <div className="empty-filter-state">
                    <strong>No verified routes are available for that meetup point right now.</strong>
                    <span>Try another start point, or try again when the routing service is available.</span>
                  </div>
                ) : filteredResults?.sections.length ? filteredResults.sections.map((section: RouteSection) => (
                  <div key={section.id} className="results-stack">
                    <div className="participants-header">
                      <div>
                        <h3>{section.title}</h3>
                        <p>
                          {section.id === "best-fair-routes"
                            ? "These have exact ride-home checks and the strongest fairness after route quality is applied."
                            : section.id === "more-route-options"
                              ? "Useful backups when you want a different distance or finish. Estimated fairness stays here until exact checks run."
                              : "These exceed the usual fairness target, but remain visible so difficult groups still have honest options."}
                        </p>
                      </div>
                    </div>
                    {section.routes.map((route) => (
                      <RouteCard
                        key={route.id}
                        route={route}
                        startLabel={resolvedStart?.label}
                        bestFairnessRouteId={section.bestFairnessRouteId}
                        selectedRouteId={selectedRouteId}
                        expanded={expandedRouteIds.includes(route.id)}
                        onSelect={handleSelectRoute}
                        onToggleDetails={toggleRouteDetails}
                      />
                    ))}
                  </div>
                )) : (
                  <div className="empty-filter-state">
                    <strong>No routes match those filters.</strong>
                    <span>Try a lower minimum distance or a wider fairness spread.</span>
                    <button type="button" className="secondary-button" onClick={resetRouteFilters}>
                      Reset filters
                    </button>
                  </div>
                )}
                {planningSession?.nextPageToken ? (
                  <div className="results-toolbar">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleLoadMore}
                      disabled={status !== "idle"}
                    >
                      {status === "planning" ? "Loading..." : "Load more routes"}
                    </button>
                    <div className="results-toolbar-copy">
                      <span>Fetch the next page of official-network candidates and rerank them.</span>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="placeholder-copy">
                No route cards yet. Pick the riders&apos; stations and run the planner to generate balanced route options.
              </p>
            )}
          </section>
        </main>
      </div>

      {showRouteFilters ? (
        <dialog
          ref={filterDialogRef}
          className="filter-sheet"
          aria-label="Route filters"
          onCancel={(event) => {
            event.preventDefault();
            closeRouteFilters();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeRouteFilters();
            }
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeRouteFilters();
            }
          }}
        >
            <div className="filter-sheet-handle" />
            <div className="filter-sheet-head">
              <div>
                <strong>Filter routes</strong>
                <p>Show only routes that match your distance and fairness targets.</p>
              </div>
              <button type="button" className="icon-button" onClick={closeRouteFilters} aria-label="Close filters">
                &times;
              </button>
            </div>

            <label className="field compact-field">
              <span>Minimum route distance</span>
              <select
                value={minimumDistanceKm}
                onChange={(event) => setMinimumDistanceKm(Number(event.target.value))}
              >
                {distanceFilterOptions.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Any distance" : `${value} km or more`}
                  </option>
                ))}
              </select>
            </label>

            <label className="field compact-field">
              <span>Maximum fairness spread</span>
              <select
                value={maximumFairnessSpreadMinutes}
                onChange={(event) => setMaximumFairnessSpreadMinutes(Number(event.target.value))}
              >
                {spreadFilterOptions.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Any spread" : `${value} min or less`}
                  </option>
                ))}
              </select>
            </label>

            <div className="filter-sheet-actions">
              <button type="button" className="secondary-button" onClick={resetRouteFilters}>
                Reset
              </button>
              <button type="button" className="primary-button dark" onClick={closeRouteFilters}>
                Show {allRouteCount || totalRouteCount} routes
              </button>
            </div>
        </dialog>
      ) : null}
    </>
  );
}
