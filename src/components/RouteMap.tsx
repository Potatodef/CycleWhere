import { useEffect, useRef } from "react";
import { useState } from "react";
import maplibregl from "maplibre-gl";
import type { RoutePlan, ResolvedParticipant } from "../types.js";

type RouteMapProps = {
  start: {
    label: string;
    point: { lat: number; lng: number };
  } | null;
  participants: ResolvedParticipant[];
  selectedRoute: RoutePlan | null;
};

export function RouteMap({ start, participants, selectedRoute }: RouteMapProps) {
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
        style: {
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
        },
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

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapError]);

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

      if (start) {
        const element = document.createElement("div");
        element.className = "map-pin map-pin-start";
        const marker = new maplibregl.Marker({ element })
          .setLngLat([start.point.lng, start.point.lat])
          .addTo(map);
        markersRef.current.push(marker);
        points.push(start.point);
      }

      participants.forEach((participant) => {
        const homeElement = document.createElement("div");
        homeElement.className = "map-pin map-pin-home";
        const homeMarker = new maplibregl.Marker({ element: homeElement })
          .setLngLat([participant.home.point.lng, participant.home.point.lat])
          .addTo(map);
        markersRef.current.push(homeMarker);
        points.push(participant.home.point);
      });

      if (!selectedRoute) {
        if (map.getLayer(routeLayerId)) {
          map.removeLayer(routeLayerId);
        }
        if (map.getSource(routeSourceId)) {
          map.removeSource(routeSourceId);
        }
      } else {
        const endpointElement = document.createElement("div");
        endpointElement.className = "map-pin map-pin-end";
        const endpointMarker = new maplibregl.Marker({ element: endpointElement })
          .setLngLat([selectedRoute.endpoint.lng, selectedRoute.endpoint.lat])
          .addTo(map);
        markersRef.current.push(endpointMarker);
        points.push(...selectedRoute.geometry);

        const geojson = {
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

        if (map.getSource(routeSourceId)) {
          (map.getSource(routeSourceId) as maplibregl.GeoJSONSource).setData(geojson);
        } else {
          map.addSource(routeSourceId, {
            type: "geojson",
            data: geojson
          });
          map.addLayer({
            id: routeLayerId,
            type: "line",
            source: routeSourceId,
            paint: {
              "line-color": "#2f493f",
              "line-width": 4.5,
              "line-opacity": 0.9
            }
          });
        }
      }

      if (points.length > 0) {
        const bounds = points.reduce(
          (accumulator, point) => accumulator.extend([point.lng, point.lat]),
          new maplibregl.LngLatBounds([points[0].lng, points[0].lat], [points[0].lng, points[0].lat])
        );
        map.fitBounds(bounds, {
          padding: 48,
          duration: 600
        });
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("load", syncMap);
      return () => {
        map.off("load", syncMap);
      };
    }

    syncMap();
  }, [mapError, participants, selectedRoute, start]);

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
