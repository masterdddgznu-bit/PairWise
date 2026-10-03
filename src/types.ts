import type { VirtualClock } from "./clock.js";

export type ViewLogOptions = {
  clock: VirtualClock;
  replicas: string[];
  quorum?: number;
  proposeTimeoutMs?: number;
};

export type LogEntry = {
  index: number;
  view: number;
  payload: string;
  proposedAt: number;
};

export type CommittedEntry = {
  index: number;
  view: number;
  payload: string;
};
