export type TxnId = string;
export type ResourceId = string;
export type LockMode = "S" | "X";
export type TxnStatus = "active" | "waiting" | "committed" | "aborted";

export interface Clock {
  nowMs(): number;
}

export interface HeldLock {
  resource: ResourceId;
  mode: LockMode;
}
