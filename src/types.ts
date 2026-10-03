import type { VirtualClock } from "./clock.js";

export type OwnRouteOptions = {
  clock: VirtualClock;
  owners: string[];
  vnodeCount: number;
};

export type ReadView = {
  value: string;
  ownerId: string;
  epoch: number;
};

export type WriteResult = "ok" | "not_owner" | "stale_fence";

export type HandoffPhase = "proposed" | "prepared";

export type HandoffView = {
  moveId: string;
  from: string;
  to: string;
  phase: HandoffPhase;
};
