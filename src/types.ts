import type { VirtualClock } from "./clock.js";

export type TicketStatus =
  | "waiting"
  | "held"
  | "released"
  | "expired"
  | "timeout"
  | "cancelled";

export interface GrantedResult {
  status: "granted";
  ticket: number;
  fence: number;
  granted: Record<string, number>;
}

export interface WaitingResult {
  status: "waiting";
  ticket: number;
}

export type ReserveResult = GrantedResult | WaitingResult;

export interface ReserveOptions {
  priority?: number;
  holdDeadlineMs?: number | null;
}

export interface DriveReport {
  expired: number[];
  timedOut: number[];
}

export interface HeldInfo {
  ticket: number;
  fence: number;
  remaining: Record<string, number>;
}

export interface ResvMeshConfig {
  clock: VirtualClock;
  capacity: Record<string, number>;
  leaseMs: number;
  waitTimeoutMs?: number;
}
