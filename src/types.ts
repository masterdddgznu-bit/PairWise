export interface RegionAllocation {
  regionId: string;
  amount: number;
}

export interface TenantConfig {
  tenantId: string;
  quota: number;
  regions: RegionAllocation[];
}

export interface TenantView {
  tenantId: string;
  configuredQuota: number;
  consumed: number;
  availableByRegion: Record<string, number>;
  reservedByRegion: Record<string, number>;
  lockedByRegion: Record<string, number>;
}

export interface GlobalView {
  capacity: number;
  allocated: number;
  remaining: number;
}

export type TransferPhase = "prepared" | "accepted" | "cancelled";

export interface TransferView {
  id: string;
  tenantId: string;
  from: string;
  to: string;
  amount: number;
  epoch: number;
  nonce: string;
  phase: TransferPhase;
}

export type ReservationPhase = "active" | "committed" | "released" | "expired";

export interface ReservationView {
  id: string;
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

export interface PrepareTransferParams {
  tenantId: string;
  from: string;
  to: string;
  amount: number;
  epoch: number;
  nonce: string;
  at: number;
}

export interface TransferTokenParams {
  transferId: string;
  epoch: number;
  nonce: string;
  at: number;
}

export interface ReserveParams {
  tenantId: string;
  regionId: string;
  worker: string;
  owner: string;
  amount: number;
  leaseMs: number;
  at: number;
}

export interface ReservationActionParams {
  reservationId: string;
  owner: string;
  fence: number;
  at: number;
}

export type JournalKind =
  | "tenant.added"
  | "transfer.prepared"
  | "transfer.accepted"
  | "transfer.cancelled"
  | "reservation.reserved"
  | "reservation.committed"
  | "reservation.released"
  | "reservation.expired";

export interface JournalEntry {
  seq: number;
  at: number;
  kind: JournalKind;
  data: Record<string, unknown>;
}

export type Mode = "live" | "replay";
