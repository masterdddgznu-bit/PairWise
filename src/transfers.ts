import { EscrowError } from "./errors";
import { availableOf, requireRegion, type TenantState } from "./tenants";
import type { Mode, PrepareTransferParams, TransferPhase } from "./types";

export interface TransferState {
  id: string;
  tenantId: string;
  from: string;
  to: string;
  amount: number;
  epoch: number;
  nonce: string;
  phase: TransferPhase;
}

export interface TransferStore {
  byId: Map<string, TransferState>;
  byIdentity: Map<string, TransferState>;
  laneEpoch: Map<string, number>;
  nextSeq: number;
}

export function createTransferStore(): TransferStore {
  return { byId: new Map(), byIdentity: new Map(), laneEpoch: new Map(), nextSeq: 1 };
}

function laneKey(tenantId: string, from: string, to: string): string {
  return `${tenantId} ${from}->${to}`;
}

function identityKey(tenantId: string, from: string, to: string, epoch: number, nonce: string): string {
  return `${laneKey(tenantId, from, to)}#${epoch}#${nonce}`;
}

export function nextTransferId(store: TransferStore): string {
  return `t${store.nextSeq}`;
}

export function prepareTransfer(
  store: TransferStore,
  tenant: TenantState,
  params: PrepareTransferParams,
  mode: Mode,
  replayId?: string,
): { transfer: TransferState; created: boolean } {
  const identity = identityKey(params.tenantId, params.from, params.to, params.epoch, params.nonce);
  const existing = store.byIdentity.get(identity);
  if (existing) {
    if (mode === "replay") {
      throw new EscrowError("DUPLICATE_MUTATION", `duplicate transfer prepare for ${identity}`);
    }
    if (existing.amount !== params.amount) {
      throw new EscrowError("TRANSFER_CONFLICT", `conflicting amount for transfer identity ${identity}`);
    }
    return { transfer: existing, created: false };
  }
  const lane = laneKey(params.tenantId, params.from, params.to);
  const laneMax = store.laneEpoch.get(lane) ?? 0;
  if (params.epoch < laneMax) {
    throw new EscrowError("STALE_EPOCH", `epoch ${params.epoch} is stale for lane ${lane}`);
  }
  if (params.epoch === laneMax) {
    throw new EscrowError("TRANSFER_CONFLICT", `epoch ${params.epoch} already used on lane ${lane}`);
  }
  const fromRegion = requireRegion(tenant, params.from);
  if (availableOf(fromRegion) < params.amount) {
    throw new EscrowError("LOCAL_CAPACITY", `insufficient local rights in ${params.from}`);
  }
  const id = nextTransferId(store);
  if (mode === "replay" && replayId !== id) {
    throw new EscrowError("JOURNAL_INVALID", `expected transfer id ${id} but found ${String(replayId)}`);
  }
  const transfer: TransferState = {
    id,
    tenantId: params.tenantId,
    from: params.from,
    to: params.to,
    amount: params.amount,
    epoch: params.epoch,
    nonce: params.nonce,
    phase: "prepared",
  };
  fromRegion.locked += params.amount;
  store.byId.set(id, transfer);
  store.byIdentity.set(identity, transfer);
  store.laneEpoch.set(lane, params.epoch);
  store.nextSeq += 1;
  return { transfer, created: true };
}

export function acceptTransfer(store: TransferStore, tenant: TenantState, transfer: TransferState, mode: Mode): boolean {
  if (transfer.phase === "accepted") {
    if (mode === "replay") {
      throw new EscrowError("DUPLICATE_MUTATION", `duplicate accept for transfer ${transfer.id}`);
    }
    return false;
  }
  if (transfer.phase === "cancelled") {
    throw new EscrowError("TRANSFER_PHASE", `transfer ${transfer.id} is cancelled`);
  }
  const fromRegion = requireRegion(tenant, transfer.from);
  const toRegion = requireRegion(tenant, transfer.to);
  fromRegion.locked -= transfer.amount;
  fromRegion.rights -= transfer.amount;
  toRegion.rights += transfer.amount;
  transfer.phase = "accepted";
  return true;
}

export function cancelTransfer(store: TransferStore, tenant: TenantState, transfer: TransferState, mode: Mode): boolean {
  if (transfer.phase === "cancelled") {
    if (mode === "replay") {
      throw new EscrowError("DUPLICATE_MUTATION", `duplicate cancel for transfer ${transfer.id}`);
    }
    return false;
  }
  if (transfer.phase === "accepted") {
    throw new EscrowError("TRANSFER_PHASE", `transfer ${transfer.id} is accepted`);
  }
  const fromRegion = requireRegion(tenant, transfer.from);
  fromRegion.locked -= transfer.amount;
  transfer.phase = "cancelled";
  return true;
}
