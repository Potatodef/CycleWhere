import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { RoutePlan, ResolvedParticipant } from "../types.js";

export type MapStyleId = "osm-bright" | "alidade-smooth" | "classic-osm";

type RouteMapProps = {
  start: {
    label: string;
    point: { lat: number; lng: number };
  } | null;
  participants: ResolvedParticipant[];
  participantMarkerColors: Record<string, string>;
  selectedRoute: RoutePlan | null;
  mapStyle: MapStyleId;
};

export const mapStyleOptions: Array<{
  id: MapStyleId;
  label: string;
  summary: string;
}> = [
  {
    id: "osm-bright",
    label: "Street",
    summary: "Closest to a mainstream road-map look, with clear roads and labels."
  },
  {
    id: "alidade-smooth",
    label: "Minimal",
    summary: "Cleaner and calmer when route overlays and markers need to stand out."
  },
  {
    id: "classic-osm",
    label: "Classic",
    summary: "The familiar OpenStreetMap raster style with broad place coverage."
  }
];

function createClassicStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors"
      }
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm"
      }
    ]
  };
}

function getMapStyle(styleId: MapStyleId): string | StyleSpecification {
  switch (styleId) {
    case "osm-bright":
      return "https://tiles.stadiamaps.com/styles/osm_bright.json";
    case "alidade-smooth":
      return "https://tiles.stadiamaps.com/styles/alidade_smooth.json";
    default:
      return createClassicStyle();
  }
}

function buildMarker(className: string, color?: string) {
  const element = document.createElement("div");
  element.className = className;

  if (color) {
    element.style.setProperty("--pin-color", color);
  }

  return element;
}

function buildStartMarker() {
  const element = document.createElement("div");
  element.className = "map-start-marker";
  element.innerHTML = '<span class="map-start-marker-core"></span>';
  return element;
}

function buildEndMarker() {
  const element = document.createElement("div");
  element.className = "map-end-marker";
  element.innerHTML =
    '<span class="map-end-marker-pole"></span><span class="map-end-marker-flag"></span>';
  return element;
}

export function RouteMap({
  start,
  participants,
  participantMarkerColors,
  selectedRoute,
  mapStyle
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapError) {
      return;
    }

    let map: maplibregl.Map;

    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: getMapStyle(mapStyle),
        center: [103.8198, 1.3521],
        zoom: 10.2
      });
    } catch {
      setMapError("Map preview unavailable in this browser. The planner still works.");
      return;
    }

    map.on("error", (event) => {
      const errorMessage =
        event.error instanceof Error ? event.error.message : "Map preview unavailable in this browser.";
      setMapError(errorMessage);
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapError, mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapError) {
      return;
    }

    map.setStyle(getMapStyle(mapStyle));
  }, [mapError, mapStyle]);

  useEffect(() => {
    if (mapError) {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    }
  }, [mapError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapError) {
      return;
    }

    const syncMap = () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      const points: Array<{ lat: number; lng: number }> = [];
      const routeSourceId = "route-source";
      const routeLayerId = "route-line";

      if (map.getLayer(routeLayerId)) {
        map.removeLayer(routeLayerId);
      }
      if (map.getSource(routeSourceId)) {
        map.removeSource(routeSourceId);
      }

      if (start) {
        const marker = new maplibregl.Marker({ element: buildStartMarker() })
          .setLngLat([start.point.lng, start.point.lat])
          .addTo(map);
        markersRef.current.push(marker);
        points.push(start.point);
      }

      participants.forEach((participant) => {
        const marker = new maplibregl.Marker({
          element: buildMarker(
            "map-pin map-pin-person",
            participantMarkerColors[participant.id] ?? "#2f5b41"
          )
        })
          .setLngLat([participant.stationResolution.point.lng, participant.stationResolution.point.lat])
          .addTo(map);
        markersRef.current.push(marker);
        points.push(participant.stationResolution.point);
      });

      if (selectedRoute) {
        const endpointMarker = new maplibregl.Marker({ element: buildEndMarker() })
          .setLngLat([selectedRoute.endpoint.lng, selectedRoute.endpoint.lat])
          .addTo(map);
        markersRef.current.push(endpointMarker);

        const routeGeojson = {
          type: "FeatureCollection" as const,
          features: [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: selectedRoute.geometry.map((point) => [point.lng, point.lat])
              },
              properties: {}
            }
          ]
        };

        map.addSource(routeSourceId, {
          type: "geojson",
          data: routeGeojson
        });
        map.addLayer({
          id: routeLayerId,
          type: "line",
          source: routeSourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round"
          },
          paint: {
            "line-color": "#204d38",
            "line-width": 5,
            "line-opacity": 0.9
          }
        });
        points.push(...selectedRoute.geometry);
      }

      if (points.length > 0) {
        const bounds = points.reduce(
          (accumulator, point) => accumulator.extend([point.lng, point.lat]),
          new maplibregl.LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat])
        );
        map.fitBounds(bounds, {
          padding: 52,
          duration: 600
        });
      }
    };

    if (!map.isStyleLoaded()) {
      const handleStyleData = () => {
        if (!map.isStyleLoaded()) {
          return;
        }
        map.off("styledata", handleStyleData);
        syncMap();
      };

      map.on("styledata", handleStyleData);
      return () => {
        map.off("styledata", handleStyleData);
      };
    }

    syncMap();
  }, [mapError, mapStyle, participantMarkerColors, participants, selectedRoute, start]);

  if (mapError) {
    return (
      <div className="map-shell map-fallback" aria-label="Route preview unavailable">
        <div className="map-fallback-copy">
          <strong>Map preview unavailable</strong>
          <span>{mapError}</span>
          <span>The route cards and fairness scoring still work.</span>
        </div>
      </div>
    );
  }

  return <div className="map-shell" ref={containerRef} aria-label="Route preview map" />;
}
