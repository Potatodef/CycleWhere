import { planRoutes } from "../lib/planner.js";
import type {
  LiveDiscoveryStatus,
  PlannedRoutes,
  ResolvedParticipant,
  RouteCandidate,
  ZoneDiscoveryStatus
} from "../types.js";

type WorkerRequest = {
  candidates: RouteCandidate[];
  participants: ResolvedParticipant[];
  startTimeIso: string;
  transitOverrides?: Record<string, number>;
  zoneStatuses?: ZoneDiscoveryStatus[];
  liveDiscoveryStatus?: LiveDiscoveryStatus;
};

type WorkerResponse = PlannedRoutes;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const result: WorkerResponse = planRoutes(event.data);
  self.postMessage(result);
};

export {};
