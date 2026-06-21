import type { PlannedRoutes } from "../types.js";

export function filterPlannedRoutes(
  results: PlannedRoutes,
  filters: {
    minimumDistanceKm: number;
    maximumFairnessSpreadMinutes: number;
  }
): PlannedRoutes {
  return {
    ...results,
    sections: results.sections
      .map((section) => {
        const routes = section.routes.filter((route) => {
          if (filters.minimumDistanceKm > 0 && route.distanceKm < filters.minimumDistanceKm) {
            return false;
          }

          if (
            filters.maximumFairnessSpreadMinutes > 0 &&
            route.fairnessSpreadMinutes > filters.maximumFairnessSpreadMinutes
          ) {
            return false;
          }

          return true;
        });

        return {
          ...section,
          routes,
          bestFairnessRouteId: routes.some((route) => route.id === section.bestFairnessRouteId)
            ? section.bestFairnessRouteId
            : routes[0]?.id
        };
      })
      .filter((section) => section.routes.length > 0)
  };
}
