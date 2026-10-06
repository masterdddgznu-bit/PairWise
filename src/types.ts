import type { VirtualClock } from "./clock.js";

export interface KeyRollConfig {
  clock: VirtualClock;
  leaseMs: number;
  maxTenants?: number;
  maxObjects?: number;
  maxTasks?: number;
}

export type TaskState = "pending" | "leased" | "done";

export interface TaskView {
  id: number;
  tenant: string;
  objectId: string;
  fromEpoch: string;
  toEpoch: string;
  state: TaskState;
  fence: number;
  worker?: string;
  deadline?: number;
}

export interface ClaimTicket {
  taskId: number;
  tenant: string;
  objectId: string;
  fromEpoch: string;
  toEpoch: string;
  fence: number;
  deadline: number;
}

export interface LeaseInfo {
  taskId: number;
  fence: number;
  deadline: number;
}

export interface RotationStatus {
  fromEpoch: string;
  toEpoch: string;
  remaining: number;
}

export interface TenantStatus {
  currentEpoch: string;
  retiredEpochs: string[];
  rotation?: RotationStatus;
}

interface WalBase {
  seq: number;
  at: number;
}

export interface TenantEntry extends WalBase {
  type: "tenant";
  tenant: string;
  epoch: string;
}

export interface ObjectEntry extends WalBase {
  type: "object";
  tenant: string;
  objectId: string;
}

export interface RotateEntry extends WalBase {
  type: "rotate";
  tenant: string;
  fromEpoch: string;
  toEpoch: string;
  objects: string[];
}

export interface ClaimEntry extends WalBase {
  type: "claim";
  taskId: number;
  worker: string;
  fence: number;
  deadline: number;
}

export interface RenewEntry extends WalBase {
  type: "renew";
  taskId: number;
  worker: string;
  fence: number;
  deadline: number;
}

export interface CompleteEntry extends WalBase {
  type: "complete";
  taskId: number;
  worker: string;
  fence: number;
}

export interface ExpireEntry extends WalBase {
  type: "expire";
  taskId: number;
  worker: string;
}

export interface RetireEntry extends WalBase {
  type: "retire";
  tenant: string;
  epoch: string;
}

export type WalEntry =
  | TenantEntry
  | ObjectEntry
  | RotateEntry
  | ClaimEntry
  | RenewEntry
  | CompleteEntry
  | ExpireEntry
  | RetireEntry;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type WalRecord = DistributiveOmit<WalEntry, "seq">;
