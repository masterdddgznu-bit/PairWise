import type { VirtualClock } from "./clock.js";

export type WatchBusOptions = {
  clock: VirtualClock;
  capacity?: number;
  ackTimeoutMs?: number;
};

export type Envelope = {
  seq: number;
  topic: string;
  payload: string;
  redelivery: boolean;
};

export type LogRecord = {
  seq: number;
  topic: string;
  payload: string;
};
