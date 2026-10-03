import type { VirtualClock } from "./clock.js";

export type TxnPhase =
  | "open"
  | "preparing"
  | "prepared"
  | "committing"
  | "committed"
  | "aborting"
  | "aborted"
  | "unknown";

export type LocalPhase = "none" | "prepared" | "committed" | "aborted";

export type TxnPrepOptions = {
  clock: VirtualClock;
  participants: string[];
  prepareTimeoutMs: number;
  commitTimeoutMs: number;
};

export type JournalDecision = "commit" | "abort" | null;
