import type { VirtualClock } from "./clock.js";

export type EpochMVCCOptions = {
  clock: VirtualClock;
  pinTtlMs?: number | null;
};

export type Version = {
  epoch: number;
  value: string | null;
};

export type WriteOp = { kind: "put"; value: string } | { kind: "del" };
