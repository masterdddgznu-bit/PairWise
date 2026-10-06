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
  worker: string | undefined;
  deadline: number | undefined;
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

export interface ClaimResult {
  taskId: number;
  tenant: string;
  objectId: string;
  fromEpoch: string;
  toEpoch: string;
  fence: number;
  deadline: number;
}

export interface RenewResult {
  taskId: number;
  deadline: number;
}

interface WalEntryBase {
  seq: number;
  at: number;
}

export interface TenantWalEntry extends WalEntryBase {
  type: "tenant";
  tenant: string;
  epoch: string;
}

export interface ObjectWalEntry extends WalEntryBase {
  type: "object";
  tenant: string;
  objectId: string;
  epoch: string;
}

export interface RotateTaskRef {
  id: number;
  objectId: string;
}

export interface RotateWalEntry extends WalEntryBase {
  type: "rotate";
  tenant: string;
  fromEpoch: string;
  toEpoch: string;
  tasks: RotateTaskRef[];
}

export interface ClaimWalEntry extends WalEntryBase {
  type: "claim";
  taskId: number;
  worker: string;
  fence: number;
  deadline: number;
}

export interface RenewWalEntry extends WalEntryBase {
  type: "renew";
  taskId: number;
  worker: string;
  fence: number;
  deadline: number;
}

export interface CompleteWalEntry extends WalEntryBase {
  type: "complete";
  taskId: number;
  worker: string;
  fence: number;
}

export interface ExpireWalEntry extends WalEntryBase {
  type: "expire";
  taskId: number;
  worker: string;
  fence: number;
}

export interface RetireWalEntry extends WalEntryBase {
  type: "retire";
  tenant: string;
  epoch: string;
}

export type WalEntry =
  | TenantWalEntry
  | ObjectWalEntry
  | RotateWalEntry
  | ClaimWalEntry
  | RenewWalEntry
  | CompleteWalEntry
  | ExpireWalEntry
  | RetireWalEntry;

type DistributeOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type WalPayload = DistributeOmit<WalEntry, "seq" | "at">;
