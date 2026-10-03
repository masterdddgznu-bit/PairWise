import type { VirtualClock } from "./clock.js";

export type CausBufOptions = {
  clock: VirtualClock;
  nodes: string[];
  self: string;
  capacity?: number;
};

export type VectorClock = Record<string, number>;

export type Message = {
  sender: string;
  vc: VectorClock;
  payload: string;
  seq: number;
};

export type ReceiveResult = "delivered" | "buffered" | "duplicate" | "ignored";
