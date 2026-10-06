export interface ClockLike {
  now(): number;
}

export interface VnodeOwnOptions {
  clock: ClockLike;
  leaseMs: number;
  vnodeCount: number;
  maxNodes?: number;
  maxPending?: number;
  maxKeys?: number;
}

export type VnodeOwnReplayOptions = Omit<VnodeOwnOptions, "clock">;

export interface LeaseInfo {
  fence: number;
  expireAt: number;
}

export interface Migration {
  key: string;
  from: string;
  to: string;
}

export interface PutResult {
  owner: string;
  migrating: boolean;
}

export type JournalEntry =
  | { seq: number; type: "acquire"; node: string; fence: number; expireAt: number }
  | { seq: number; type: "renew"; node: string; fence: number; expireAt: number }
  | { seq: number; type: "release"; node: string }
  | { seq: number; type: "join"; node: string }
  | { seq: number; type: "leave"; node: string }
  | { seq: number; type: "expire"; nodes: string[] }
  | { seq: number; type: "put"; key: string; value: unknown }
  | { seq: number; type: "ack"; key: string }
  | { seq: number; type: "drain" };
