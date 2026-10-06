import { EscrowError } from "./errors";
import { availableOf, requireRegion, type TenantState } from "./tenants";
import type { Mode, ReservationPhase, ReserveParams } from "./types";

export interface ReservationState {
  id: string;
  seq: number;
  tenantId: string;
  regionId: string;
  worker: string;
  owner: string;
  amount: number;
  fence: number;
  createdAt: number;
  expiresAt: number;
  phase: ReservationPhase;
}

export interface ReservationStore {
  byId: Map<string, ReservationState>;
  fences: Map<string, number>;
  nextSeq: number;
}

export function createReservationStore(): ReservationStore {
  return { byId: new Map(), fences: new Map(), nextSeq: 1 };
}

function fenceKey(tenantId: string, regionId: string, worker: string): string {
  return `${tenantId} ${regionId}#${worker}`;
}

export function nextReservationId(store: ReservationStore): string {
  return `r${store.nextSeq}`;
}

export interface ReserveReplay {
  id: unknown;
  fence: unknown;
  expiresAt: unknown;
}

export function reserve(
  store: ReservationStore,
  tenant: TenantState,
  params: ReserveParams,
  expiresAt: number,
  mode: Mode,
  replay?: ReserveReplay,
): ReservationState {
  const region = requireRegion(tenant, params.regionId);
  if (availableOf(region) < params.amount) {
    throw new EscrowError("LOCAL_CAPACITY", `insufficient local rights in ${params.regionId}`);
  }
  const key = fenceKey(params.tenantId, params.regionId, params.worker);
  const fence = (store.fences.get(key) ?? 0) + 1;
  const id = nextReservationId(store);
  if (mode === "replay") {
    if (!replay || replay.id !== id) {
      throw new EscrowError("JOURNAL_INVALID", `expected reservation id ${id} but found ${String(replay?.id)}`);
    }
    if (replay.fence !== fence) {
      throw new EscrowError("JOURNAL_INVALID", `expected fence ${fence} but found ${String(replay.fence)}`);
    }
    if (replay.expiresAt !== expiresAt) {
      throw new EscrowError("JOURNAL_INVALID", "recorded expiry does not match lease");
    }
  }
  const reservation: ReservationState = {
    id,
    seq: store.nextSeq,
    tenantId: params.tenantId,
    regionId: params.regionId,
    worker: params.worker,
    owner: params.owner,
    amount: params.amount,
    fence,
    createdAt: params.at,
    expiresAt,
    phase: "active",
  };
  region.reserved += params.amount;
  store.byId.set(id, reservation);
  store.fences.set(key, fence);
  store.nextSeq += 1;
  return reservation;
}

function requireActive(reservation: ReservationState, at: number, mode: Mode, ownPhase: ReservationPhase): void {
  if (reservation.phase !== "active") {
    if (mode === "replay" && reservation.phase === ownPhase) {
      throw new EscrowError("DUPLICATE_MUTATION", `duplicate mutation for reservation ${reservation.id}`);
    }
    throw new EscrowError("RESERVATION_PHASE", `reservation ${reservation.id} is ${reservation.phase}`);
  }
  if (at >= reservation.expiresAt) {
    throw new EscrowError("LEASE_EXPIRED", `reservation ${reservation.id} expired at ${reservation.expiresAt}`);
  }
}

export function commitReservation(
  store: ReservationStore,
  tenant: TenantState,
  reservation: ReservationState,
  at: number,
  mode: Mode,
): void {
  requireActive(reservation, at, mode, "committed");
  const region = requireRegion(tenant, reservation.regionId);
  region.reserved -= reservation.amount;
  region.rights -= reservation.amount;
  tenant.consumed += reservation.amount;
  reservation.phase = "committed";
}

export function releaseReservation(
  store: ReservationStore,
  tenant: TenantState,
  reservation: ReservationState,
  at: number,
  mode: Mode,
): void {
  requireActive(reservation, at, mode, "released");
  const region = requireRegion(tenant, reservation.regionId);
  region.reserved -= reservation.amount;
  reservation.phase = "released";
}

export function expireReservation(
  store: ReservationStore,
  tenant: TenantState,
  reservation: ReservationState,
  at: number,
  mode: Mode,
): void {
  if (reservation.phase !== "active") {
    if (mode === "replay" && reservation.phase === "expired") {
      throw new EscrowError("DUPLICATE_MUTATION", `duplicate expiry for reservation ${reservation.id}`);
    }
    throw new EscrowError("RESERVATION_PHASE", `reservation ${reservation.id} is ${reservation.phase}`);
  }
  if (at < reservation.expiresAt) {
    throw new EscrowError("JOURNAL_INVALID", `reservation ${reservation.id} expires at ${reservation.expiresAt}`);
  }
  const region = requireRegion(tenant, reservation.regionId);
  region.reserved -= reservation.amount;
  reservation.phase = "expired";
}

export function collectExpired(store: ReservationStore, now: number): ReservationState[] {
  const expired: ReservationState[] = [];
  for (const reservation of store.byId.values()) {
    if (reservation.phase === "active" && reservation.expiresAt <= now) {
      expired.push(reservation);
    }
  }
  expired.sort((a, b) => a.expiresAt - b.expiresAt || a.seq - b.seq);
  return expired;
}
