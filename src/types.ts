export type Timestamp = { num: number; writerId: number };
export type ReplicaStore = { value: string | null; ts: Timestamp };
export type OpKind = "write" | "read";
export type OpStatus = "pending" | "blocked" | "done" | "unknown";
export type OpPhase = "query" | "write" | "writeback";
