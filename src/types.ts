import type { VirtualClock } from "./clock.js";

export interface Hlc {
  pt: number;
  lc: number;
}

export interface HlcoutOptions {
  clock: VirtualClock;
  maxReplicas?: number;
  maxPending?: number;
  maxChk?: number;
}

export interface OutMsg {
  msgId: string;
  replica: string;
  hlc: Hlc;
  payload: unknown;
}

export interface CheckpointSnapshot {
  name: string;
  deliveredIds: string[];
}

export type JournalEntry =
  | { op: "register"; replica: string }
  | { op: "observe"; replica: string; remote: Hlc; clock: Hlc }
  | { op: "stamp"; replica: string; msgId: string; hlc: Hlc; payload: unknown }
  | { op: "frontier"; replica: string; hlc: Hlc }
  | { op: "deliver"; msgIds: string[] }
  | { op: "checkpoint"; name: string; deliveredIds: string[] }
  | { op: "drive"; removed: string[] };
