import type { VirtualClock } from "./clock.js";

export type NodeSpec = {
  id: string;
  parentId?: string | null;
  soft: number;
  hard: number;
};

export type QuotaRingOptions = {
  clock: VirtualClock;
  nodes: NodeSpec[];
};

export type ReserveResult = { ok: true } | { ok: false; reason: string };

export type UsageView = {
  committed: number;
  reserved: number;
  soft: number;
  hard: number;
  overSoft: boolean;
};

export type Ticket = {
  ticketId: string;
  nodeId: string;
  remaining: number;
  expireAt: number;
};
