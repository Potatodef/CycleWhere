import { useEffect, useMemo, useRef, useState } from "react";
import { RouteMap } from "./components/RouteMap.js";
import { formatIsoLocal, roundToFiveMinutes } from "./lib/geo.js";
import {
  discoverCyclingRoutes,
  geocodeQueries,
  fetchTransitTimes,
  resolveParticipants
} from "./lib/api.js";
import { buildTransitQueries, generateCuratedCandidates } from "./lib/planner.js";
import type {
  PlannedRoutes,
  ResolvedParticipant,
  RoutePlan,
  RouteSection,
  ThemeId
} from "./types.js";

const worker = new Worker(new URL("./workers/planner.worker.ts", import.meta.url), {
  type: "module"
});

const themeOptions: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: "neutral-ink", label: "Neutral Ink", description: "Paper, charcoal, and a calm civic feel." },
  { id: "forest", label: "Forest", description: "Greener and outdoorsy without getting loud." },
  { id: "warm-clay", label: "Warm Clay", description: "Warmer surfaces for lighter A/B testing." }
];

const avatarColors = [
  { avatar: "oklch(48% 0.14 158)", rowBg: "oklch(97% 0.006 158)", border: "oklch(92% 0.012 158)" },
  { avatar: "oklch(52% 0.12 55)", rowBg: "oklch(97% 0.008 55)", border: "oklch(92% 0.015 55)" },
  { avatar: "oklch(50% 0.12 280)", rowBg: "oklch(97% 0.006 280)", border: "oklch(92% 0.012 280)" },
  { avatar: "oklch(55% 0.12 85)", rowBg: "oklch(97% 0.008 85)", border: "oklch(92% 0.015 85)" }
];

const exampleHomes = [
  { id: "1", name: "Ariel", address: "Bedok Reservoir" },
  { id: "2", name: "Ben", address: "Tampines Central" },
  { id: "3", name: "Charis", address: "Marine Parade" },
  { id: "4", name: "Deepa", address: "Punggol Waterway" }
];

function formatCoverage(value?: number) {
  return value === undefined ? "n/a" : `${Math.round(value * 100)}%`;
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return `${hours}h ${minutes}m`;
}

function getApiBase() {
  const fromImportMeta =
    (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";
  const fromWindow = (window as Window & {
    __CYCLEWHERE_CONFIG__?: { apiBase?: string };
  }).__CYCLEWHERE_CONFIG__?.apiBase;

  return fromImportMeta || fromWindow || "";
}

function themeFromStorage(): ThemeId {
  const stored = localStorage.getItem("cyclewhere-theme");
  if (stored === "neutral-ink" || stored === "forest" || stored === "warm-clay") {
    return stored;
  }
  return "neutral-ink";
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

function routeConfidenceLabel(route: RoutePlan) {
  switch (route.confidence) {
    case "validated":
      return "Validated by known corridor";
    case "aligned":
      return "Close to known corridor";
    case "novel":
      return "New discovered route";
    default:
      return "Curated heuristic route";
  }
}

function routeSourceLabel(route: RoutePlan) {
  return route.source === "discovered" ? "Live discovery" : "Curated corridor";
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
  bestFairnessRouteId,
  selectedRouteId,
  expanded,
  onSelect,
  onToggleDetails
}: {
  route: RoutePlan;
  bestFairnessRouteId?: string;
  selectedRouteId: string | null;
  expanded: boolean;
  onSelect: (routeId: string) => void;
  onToggleDetails: (routeId: string) => void;
}) {
  return (
    <article
      key={route.id}
      className={`route-card ${selectedRouteId === route.id ? "selected" : ""}`}
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
            <h3>{route.corridorName || route.zoneName}</h3>
            <span className={routeBadgeClass(route)}>{route.fairnessTier}</span>
          </div>
          <p>
            {route.routeName} to {route.endpointName}
          </p>
          <div className="chip-row">
            <span className="chip">{routeSourceLabel(route)}</span>
            <span className="chip">{routeConfidenceLabel(route)}</span>
            {bestFairnessRouteId === route.id ? <span className="chip">Best fairness in section</span> : null}
          </div>
        </div>
        <div className="metric-cluster">
          <strong>{route.distanceKm.toFixed(1)} km</strong>
          <span>{formatMinutes(route.cyclingMinutes)}</span>
        </div>
      </div>

      <div className="metric-grid">
        <div>
          <span>Average home time</span>
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
          <strong>{route.mixedTrafficMeters !== undefined ? `${route.mixedTrafficMeters} m` : "Live route"}</strong>
        </div>
      </div>

      <div className="chip-row">
        <span className="chip">PCN {formatCoverage(route.pcnCoverage)}</span>
        <span className="chip">Cycling path {formatCoverage(route.cyclingPathCoverage)}</span>
        <span className="chip">Common corridor {formatCoverage(route.commonCorridorCoverage)}</span>
      </div>

      <div className="route-details" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="details-toggle"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleDetails(route.id);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleDetails(route.id);
            }
          }}
        >
          {expanded ? "Hide participant times and evidence" : "Show participant times and evidence"}
        </button>
        {expanded ? (
          <>
            <div className="details-block">
              {route.participantTimes.map((participantTime) => (
                <div key={participantTime.participantId} className="participant-time-row">
                  <span>
                    {participantTime.participantName} via {participantTime.anchorName}
                  </span>
                  <strong>{formatMinutes(participantTime.transitMinutes)}</strong>
                </div>
              ))}
            </div>
            {route.popularityEvidence?.length ? (
              <div className="details-block">
                {route.popularityEvidence.map((evidence) => (
                  <a
                    key={evidence.url}
                    href={evidence.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {evidence.label} · reviewed {evidence.reviewedOn}
                  </a>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

export function App() {
  const [theme, setTheme] = useState<ThemeId>(themeFromStorage);
  const [startQuery, setStartQuery] = useState("Marina Bay");
  const [startTime, setStartTime] = useState(formatIsoLocal(roundToFiveMinutes()));
  const [participants, setParticipants] = useState(exampleHomes);
  const [resolvedStart, setResolvedStart] = useState<{
    label: string;
    point: { lat: number; lng: number };
    source: string;
  } | null>(null);
  const [resolvedParticipants, setResolvedParticipants] = useState<ResolvedParticipant[]>([]);
  const [results, setResults] = useState<PlannedRoutes | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [expandedRouteIds, setExpandedRouteIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "resolving" | "planning">("idle");
  const [message, setMessage] = useState(
    "Resolve the start point and homes first so everyone can confirm the transport anchors before route planning."
  );
  const workerPromiseRef = useRef<((value: PlannedRoutes) => void) | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cyclewhere-theme", theme);
  }, [theme]);

  useEffect(() => {
    worker.onmessage = (event: MessageEvent<PlannedRoutes>) => {
      workerPromiseRef.current?.(event.data);
    };
  }, []);

  const allRoutes = useMemo(
    () => results?.sections.flatMap((section) => section.routes) ?? [],
    [results]
  );
  const selectedRoute = useMemo(() => {
    if (!selectedRouteId) {
      return allRoutes[0] ?? null;
    }
    return allRoutes.find((route) => route.id === selectedRouteId) ?? allRoutes[0] ?? null;
  }, [allRoutes, selectedRouteId]);
  const allRouteCount = allRoutes.length;

  function updateParticipant(
    id: string,
    key: "name" | "address",
    value: string
  ) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, [key]: value } : participant
      )
    );
  }

  function addParticipant() {
    setParticipants((current) => {
      if (current.length >= 10) {
        return current;
      }
      return [...current, { id: crypto.randomUUID(), name: "", address: "" }];
    });
  }

  function removeParticipant(id: string) {
    setParticipants((current) => {
      if (current.length <= 2) {
        return current;
      }
      return current.filter((participant) => participant.id !== id);
    });
  }

  async function handleResolve() {
    setStatus("resolving");
    setResults(null);
    setSelectedRouteId(null);
    setExpandedRouteIds([]);

    try {
      const [start] = await geocodeQueries([startQuery]);
      const people = await resolveParticipants(participants);
      setResolvedStart({
        label: start.label,
        point: start.point,
        source: start.source
      });
      setResolvedParticipants(people);
      setMessage(
        "Anchors resolved. Check the MRT or bus fallbacks below, then plan routes when the transport assumptions look right."
      );
    } finally {
      setStatus("idle");
    }
  }

  async function handlePlan() {
    if (!resolvedStart || resolvedParticipants.length !== participants.length) {
      await handleResolve();
      return;
    }

    setStatus("planning");
    setMessage(
      "Scoring curated and discovered route candidates by fairness first, then corridor confidence and distance variety."
    );

    const plannedRoutes = await new Promise<PlannedRoutes>((resolve) => {
      const planningStartIso = new Date(startTime).toISOString();
      const curatedCandidates = generateCuratedCandidates(resolvedStart);

      workerPromiseRef.current = resolve;

      const runPlanning = async () => {
        const discovered = await discoverCyclingRoutes({
          start: resolvedStart,
          participants: resolvedParticipants.map((participant) => ({
            id: participant.id,
            name: participant.name,
            home: participant.home.point,
            anchor: participant.anchor
          }))
        });

        const candidates = [...curatedCandidates, ...discovered.candidates];
        const transitQueryBundle = buildTransitQueries({
          candidates,
          participants: resolvedParticipants,
          startTimeIso: planningStartIso
        });
        const transitOverrides: Record<string, number> = {};

        if (getApiBase()) {
          const transitResults = await fetchTransitTimes(transitQueryBundle.map((item) => item.query));
          transitResults.forEach((result, index) => {
            const key = transitQueryBundle[index]?.key;
            if (key && typeof result.minutes === "number") {
              transitOverrides[key] = result.minutes;
            }
          });
        }

        worker.postMessage({
          candidates,
          participants: resolvedParticipants,
          startTimeIso: planningStartIso,
          transitOverrides,
          zoneStatuses: discovered.zoneStatuses,
          liveDiscoveryStatus: discovered.liveDiscoveryStatus
        });
      };

      void runPlanning();
    });

    setResults(plannedRoutes);
    setSelectedRouteId(plannedRoutes.sections[0]?.routes[0]?.id ?? null);
    setExpandedRouteIds([]);
    setStatus("idle");
    setMessage(
      plannedRoutes.liveDiscoveryStatus === "available"
        ? "Hybrid results ready. Trusted corridor matches and newly discovered routes are grouped separately."
        : plannedRoutes.liveDiscoveryStatus === "partial"
          ? "Partial live discovery. Curated routes remain available while some live zone lookups were unavailable."
          : "Live discovery unavailable. Showing curated corridor routes with fallback estimates where needed."
    );
  }

  function loadExample() {
    setStartQuery("Marina Bay");
    setParticipants(exampleHomes);
    setResolvedStart(null);
    setResolvedParticipants([]);
    setResults(null);
    setSelectedRouteId(null);
    setExpandedRouteIds([]);
    setMessage("Loaded a Singapore east-side example so you can test the flow quickly.");
  }

  function toggleRouteDetails(routeId: string) {
    setExpandedRouteIds((current) =>
      current.includes(routeId)
        ? current.filter((currentId) => currentId !== routeId)
        : [...current, routeId]
    );
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
        <div className="top-nav-links">
          <a href="#" className="active">
            Planner
          </a>
          <a href="#how-it-works">How it works</a>
          <a href="#results">Results</a>
        </div>
      </nav>

      <div className="app-shell">
        <div className="bg-orb bg-orb-one" />
        <div className="bg-orb bg-orb-two" />
        <header className="hero-card">
          <div className="hero-copy">
            <span className="eyebrow">CycleWhere MVP</span>
            <h1>Plan a cyclable group route whose finish gives everyone a fair ride home.</h1>
            <p>
              Route-first results for Singapore groups. The endpoint is judged by public-transport
              time spread, while the ride itself still needs to stay mostly on PCN, cycling paths,
              and common local corridors.
            </p>
          </div>

          <div className="hero-panel">
            <p className="hero-panel-label">Visual theme</p>
            <div className="theme-grid">
              {themeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`theme-swatch ${theme === option.id ? "active" : ""}`}
                  onClick={() => setTheme(option.id)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
            <div className="status-pill">{message}</div>
          </div>
        </header>

        <main className="layout-grid">
        <section className="panel panel-form">
          <AppSectionLabel
            eyebrow="Inputs"
            title="Start point, homes, and time"
            description="The planning time defaults to now, rounded to five minutes, but you can pin a specific departure just like a map app."
          />

          <div className="input-pair">
            <label className="field">
              <span>Start location</span>
              <input
                value={startQuery}
                onChange={(event) => setStartQuery(event.target.value)}
                placeholder="Marina Bay"
              />
            </label>

            <label className="field">
              <span>Planned start time</span>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </label>
          </div>

          <div className="participants-header">
            <div>
              <h3>People</h3>
              <p>2 to 10 named home addresses. Homes resolve to rail first, with a bus fallback if rail is too far away.</p>
            </div>
            <button type="button" className="ghost-button" onClick={loadExample}>
              Load example
            </button>
          </div>

          <div className="participant-list">
            {participants.map((participant, index) => {
              const colors = avatarColors[index % avatarColors.length];

              return (
                <div
                  className="participant-row"
                  key={participant.id}
                  style={{ background: colors.rowBg, border: `1px solid ${colors.border}` }}
                >
                  <div className="participant-avatar" style={{ background: colors.avatar }}>
                    {participant.name ? participant.name[0].toUpperCase() : "?"}
                  </div>
                  <div className="participant-info">
                    <input
                      className="name"
                      value={participant.name}
                      onChange={(event) => updateParticipant(participant.id, "name", event.target.value)}
                      placeholder="Name"
                    />
                    <input
                      className="address"
                      value={participant.address}
                      onChange={(event) => updateParticipant(participant.id, "address", event.target.value)}
                      placeholder="Home address or area"
                    />
                  </div>
                  {participants.length > 2 ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => removeParticipant(participant.id)}
                    >
                      ×
                    </button>
                  ) : null}
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
              Add person
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleResolve}
              disabled={status !== "idle"}
            >
              {status === "resolving" ? "Resolving..." : "Resolve anchors"}
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
              The main score is the difference between the longest and shortest journey-home time.
              Standard deviation breaks ties, and corridor confidence only helps later in ranking.
            </span>
          </div>
        </section>

        <section className="panel panel-map">
          <AppSectionLabel
            eyebrow="Preview"
            title="Resolved anchors and route focus"
            description="Homes are shown alongside the currently selected route so you can see whether the finish point makes practical sense."
          />
          <RouteMap
            start={resolvedStart}
            participants={resolvedParticipants}
            selectedRoute={selectedRoute}
          />
          <div className="map-caption">
            <span>
              {resolvedStart
                ? `Start pinned at ${resolvedStart.label}.`
                : "Resolve the start point to place it on the map."}
            </span>
            <span>
              {getApiBase()
                ? "Backend endpoints configured."
                : "Running with local fallback geocoding and transit estimates until the API is configured."}
            </span>
          </div>
        </section>

        <section className="panel panel-anchors">
          <AppSectionLabel
            eyebrow="Confirm"
            title="Transport anchors"
            description="This confirmation step is deliberate so weird addresses do not distort the fairness scoring."
          />
          <div className="anchor-grid">
            {resolvedParticipants.length === 0 ? (
              <p className="placeholder-copy">No anchors yet. Resolve the homes above to review the nearest MRT or bus fallback for each person.</p>
            ) : (
              resolvedParticipants.map((participant) => (
                <article className="anchor-card" key={participant.id}>
                  <h3>{participant.name || "Unnamed participant"}</h3>
                  <p>{participant.home.label}</p>
                  <strong>{participant.anchor.name}</strong>
                  <span>
                    {participant.anchor.kind === "rail" ? "Rail anchor" : "Bus fallback"} ·{" "}
                    {participant.anchor.distanceFromHomeKm.toFixed(1)} km from home
                  </span>
                  {participant.anchor.fallbackSuggested && participant.anchor.fallbackAnchor ? (
                    <p className="anchor-warning">
                      Rail was over 2.5 km away, so the current anchor falls back to bus. The nearest rail alternative would be {participant.anchor.fallbackAnchor.name}.
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel panel-results">
          <AppSectionLabel
            eyebrow="Results"
            title={`Route cards${allRouteCount ? ` (${allRouteCount})` : ""}`}
            description="Trusted corridor matches, newly discovered routes, and curated fallbacks are separated so you can see where the planner agrees with known cycling structure."
          />

          {results ? (
            <>
              {results.liveDiscoveryStatus !== "available" ? (
                <div className="note-box">
                  <strong>Live discovery status: {results.liveDiscoveryStatus}</strong>
                  <span>
                    {results.liveDiscoveryStatus === "partial"
                      ? "Some live route zones were unavailable, so curated corridors remain in the mix."
                      : "The app is currently relying on curated corridors and fallback estimates."}
                  </span>
                </div>
              ) : null}

              {results.zoneStatuses.length ? (
                <div className="chip-row">
                  {results.zoneStatuses.map((status) => (
                    <span key={`${status.zoneId}-${status.status}`} className="chip">
                      {status.zoneName}: {status.status}
                    </span>
                  ))}
                </div>
              ) : null}

              {results.sections.map((section: RouteSection) => (
                <div key={section.id} className="results-stack">
                  <div className="participants-header">
                    <div>
                      <h3>{section.title}</h3>
                      <p>
                        {section.id === "trusted-matches"
                          ? "Routes where live discovery and known local corridors converge."
                          : section.id === "best-discovered"
                            ? "Real discovered routes that remain fair even without a close curated match."
                            : section.id === "curated-alternatives"
                              ? "Curated routes remain available as trusted fallbacks and reference points."
                              : "These only appear for groups of at least four when one outlier is visibly longer than the rest."}
                      </p>
                    </div>
                  </div>
                  {section.routes.map((route) => (
                    <RouteCard
                      key={route.id}
                      route={route}
                      bestFairnessRouteId={section.bestFairnessRouteId}
                      selectedRouteId={selectedRouteId}
                      expanded={expandedRouteIds.includes(route.id)}
                      onSelect={setSelectedRouteId}
                      onToggleDetails={toggleRouteDetails}
                    />
                  ))}
                </div>
              ))}
            </>
          ) : (
            <p className="placeholder-copy">
              No route cards yet. Resolve the anchors and run the planner to generate balanced route options.
            </p>
          )}
        </section>
        </main>
      </div>
    </>
  );
}
