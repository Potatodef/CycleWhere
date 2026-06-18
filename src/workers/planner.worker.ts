import { planRoutes } from "../lib/planner.js";
import type { PlannedRoutes, ResolvedParticipant } from "../types.js";

type WorkerRequest = {
  start: {
    label: string;
    point: { lat: number; lng: number };
  };
  participants: ResolvedParticipant[];
  startTimeIso: string;
  transitOverrides?: Record<string, number>;
};

type WorkerResponse = PlannedRoutes;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const result: WorkerResponse = planRoutes(event.data);
  self.postMessage(result);
};

export {};
