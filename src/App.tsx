import { useEffect, useMemo, useRef, useState } from "react";
import { RouteMap } from "./components/RouteMap.js";
import { formatIsoLocal, roundToFiveMinutes } from "./lib/geo.js";
import { fetchTransitTimes, geocodeQueries, resolveParticipants } from "./lib/api.js";
import { buildTransitQueries } from "./lib/planner.js";
import type {
  PlannedRoutes,
  ResolvedParticipant,
  RoutePlan,
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

const exampleHomes = [
  { id: "1", name: "Ariel", address: "Bedok Reservoir" },
  { id: "2", name: "Ben", address: "Tampines Central" },
  { id: "3", name: "Charis", address: "Marine Parade" },
  { id: "4", name: "Deepa", address: "Punggol Waterway" }
];

function formatCoverage(value: number) {
  return `${Math.round(value * 100)}%`;
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
    (import.meta as ImportMeta & { env?: { VITE_API_BASE?: string } }).env
      ?.VITE_API_BASE ?? "";
  const fromWindow = (window as Window & {
    __CYCLEWHERE_CONFIG__?: { apiBase?: string };
  }).__CYCLEWHERE_CONFIG__?.apiBase;

  return fromImportMeta || fromWindow || "";
}

function themeFromStorage(): ThemeId {
  const stored = localStorage.getItem("cyclewhere-theme");
  if (
    stored === "neutral-ink" ||
    stored === "forest" ||
    stored === "warm-clay"
  ) {
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

  const selectedRoute = useMemo(() => {
    if (!results || !selectedRouteId) {
      return results?.primary[0] ?? results?.uneven[0] ?? null;
    }
    return (
      results.primary.find((route) => route.id === selectedRouteId) ??
      results.uneven.find((route) => route.id === selectedRouteId) ??
      null
    );
  }, [results, selectedRouteId]);

  const allRouteCount =
    (results?.primary.length ?? 0) + (results?.uneven.length ?? 0);

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
      return [
        ...current,
        { id: crypto.randomUUID(), name: "", address: "" }
      ];
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
      "Scoring route candidates by fairness first, then corridor quality and distance variety."
    );

    const plannedRoutes = await new Promise<PlannedRoutes>((resolve) => {
      const planningStartIso = new Date(startTime).toISOString();
      const transitQueryBundle = buildTransitQueries({
        start: resolvedStart,
        participants: resolvedParticipants,
        startTimeIso: planningStartIso
      });
      const transitOverrides: Record<string, number> = {};

      workerPromiseRef.current = resolve;

      const runPlanning = () => {
        worker.postMessage({
          start: resolvedStart,
          participants: resolvedParticipants,
          startTimeIso: planningStartIso,
          transitOverrides
        });
      };

      if (getApiBase()) {
        fetchTransitTimes(transitQueryBundle.map((item) => item.query))
          .then((transitResults) => {
            transitResults.forEach((result, index) => {
              const key = transitQueryBundle[index]?.key;
              if (key && typeof result.minutes === "number") {
                transitOverrides[key] = result.minutes;
              }
            });
          })
          .catch(() => {
            // The worker falls back to local estimates when live transit calls fail.
          })
          .finally(runPlanning);
        return;
      }

      runPlanning();
    });

    setResults(plannedRoutes);
    setSelectedRouteId(
      plannedRoutes.primary[0]?.id ?? plannedRoutes.uneven[0]?.id ?? null
    );
    setExpandedRouteIds([]);
    setStatus("idle");
    setMessage(
      plannedRoutes.primary.length > 0
        ? "Routes sorted from shortest to longest. Uneven routes, if any, are separated and clearly marked."
        : "No balanced routes passed the current heuristics. Check the uneven routes section for majority-friendly fallbacks."
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
            {participants.map((participant, index) => (
              <div className="participant-card" key={participant.id}>
                <div className="participant-card-top">
                  <strong>Person {index + 1}</strong>
                  {participants.length > 2 ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => removeParticipant(participant.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <input
                  value={participant.name}
                  onChange={(event) =>
                    updateParticipant(participant.id, "name", event.target.value)
                  }
                  placeholder="Name"
                />
                <input
                  value={participant.address}
                  onChange={(event) =>
                    updateParticipant(participant.id, "address", event.target.value)
                  }
                  placeholder="Home address or area"
                />
              </div>
            ))}
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
              Standard deviation breaks ties, and average travel time only helps late in ranking.
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
            description="The main list stays route-first and sorted from the lowest mileage upward, while still exposing full participant-level travel times when you expand a card."
          />

          {results?.primary.length ? (
            <div className="results-stack">
              {results.primary.map((route) => (
                (() => {
                  const isExpanded = expandedRouteIds.includes(route.id);

                  return (
                <article
                  key={route.id}
                  className={`route-card ${selectedRoute?.id === route.id ? "selected" : ""}`}
                  onClick={() => setSelectedRouteId(route.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedRouteId(route.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <div className="route-card-head">
                    <div>
                      <div className="route-title-row">
                        <h3>{route.corridorName}</h3>
                        <span className={routeBadgeClass(route)}>{route.fairnessTier}</span>
                      </div>
                      <p>
                        {route.routeName} to {route.endpointName}
                      </p>
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
                      <strong>{route.mixedTrafficMeters} m</strong>
                    </div>
                  </div>

                  <div className="chip-row">
                    <span className="chip">PCN {formatCoverage(route.pcnCoverage)}</span>
                    <span className="chip">Cycling path {formatCoverage(route.cyclingPathCoverage)}</span>
                    <span className="chip">Common corridor {formatCoverage(route.commonCorridorCoverage)}</span>
                  </div>

                  <div
                    className="route-details"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="details-toggle"
                      aria-expanded={isExpanded}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRouteDetails(route.id);
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleRouteDetails(route.id);
                        }
                      }}
                    >
                      {isExpanded
                        ? "Hide participant times and popularity evidence"
                        : "Show participant times and popularity evidence"}
                    </button>
                    {isExpanded ? (
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
                      </>
                    ) : null}
                  </div>
                </article>
                  );
                })()
              ))}
            </div>
          ) : (
            <p className="placeholder-copy">
              No route cards yet. Resolve the anchors and run the planner to generate balanced route options.
            </p>
          )}

          {results?.uneven.length ? (
            <div className="uneven-section">
              <h3>Uneven but majority-friendly</h3>
              <p>
                These only appear for groups of at least four when all but one participant still stay within 20 minutes of one another.
              </p>
              <div className="results-stack">
                {results.uneven.map((route) => (
                  <article
                    key={route.id}
                    className={`route-card uneven ${selectedRoute?.id === route.id ? "selected" : ""}`}
                    onClick={() => setSelectedRouteId(route.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedRouteId(route.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <div className="route-card-head">
                      <div>
                        <div className="route-title-row">
                          <h3>{route.corridorName}</h3>
                          <span className={routeBadgeClass(route)}>{route.fairnessTier}</span>
                        </div>
                        <p>
                          {route.routeName} to {route.endpointName}
                        </p>
                      </div>
                      <div className="metric-cluster">
                        <strong>{route.distanceKm.toFixed(1)} km</strong>
                        <span>{route.fairnessSpreadMinutes} min spread</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
