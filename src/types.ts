import type { VirtualClock } from "./clock.js";

export type WaterMeshOptions = {
  clock: VirtualClock;
  windowSize: number;
  allowedLateness: number;
};

export type Emit = {
  key: string;
  windowStart: number;
  windowEnd: number;
  count: number;
  sum: number;
};

export type LateEvent = {
  key: string;
  eventTime: number;
  payload: string;
  windowStart: number;
};

export type IngestResult = "ok" | "late" | "drop";
