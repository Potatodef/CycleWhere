import { planRoutes } from "../lib/planner.js";
import type {
  LiveDiscoveryStatus,
  PlannedRoutes,
  ResolvedParticipant,
  RouteCandidate,
  ZoneDiscoveryStatus
} from "../types.js";

type WorkerRequest = {
  requestId: number;
  candidates: RouteCandidate[];
  participants: ResolvedParticipant[];
  startTimeIso: string;
  transitOverrides?: Record<string, number>;
  zoneStatuses?: ZoneDiscoveryStatus[];
  liveDiscoveryStatus?: LiveDiscoveryStatus;
};

type WorkerResponse =
  | { ok: true; requestId: number; plannedRoutes: PlannedRoutes }
  | { ok: false; requestId: number; error: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const result = planRoutes(event.data);
    self.postMessage({
      ok: true,
      requestId: event.data.requestId,
      plannedRoutes: result
    } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({
      ok: false,
      requestId: event.data.requestId,
      error: error instanceof Error ? error.message : "Route planning failed."
    } satisfies WorkerResponse);
  }
};

export {};
