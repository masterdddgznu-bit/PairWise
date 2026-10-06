export type TransferPhase = "prepared" | "accepted" | "cancelled";

export type ReservationPhase = "active" | "committed" | "released" | "expired";

export type JournalKind =
  | "tenant.added"
  | "transfer.prepared"
  | "transfer.accepted"
  | "transfer.cancelled"
  | "reservation.reserved"
  | "reservation.committed"
  | "reservation.released"
  | "reservation.expired";

export interface RegionSplit {
  regionId: string;
  amount: number;
}

export interface TenantConfig {
  tenantId: string;
  quota: number;
  regions: RegionSplit[];
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

export interface PrepareTransferParams {
  tenantId: string;
  from: string;
  to: string;
  amount: number;
  epoch: number;
  nonce: string;
  at: number;
}

export interface TransferDecisionParams {
  transferId: string;
  epoch: number;
  nonce: string;
  at: number;
}

export interface TransferRecord {
  id: string;
  tenantId: string;
  from: string;
  to: string;
  amount: number;
  epoch: number;
  nonce: string;
  phase: TransferPhase;
  preparedAt: number;
  settledAt: number | null;
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

export interface ReservationRecord {
  id: string;
  tenantId: string;
  regionId: string;
  worker: string;
  owner: string;
  amount: number;
  fence: number;
  reservedAt: number;
  expiresAt: number;
  phase: ReservationPhase;
}

export interface JournalEntry {
  seq: number;
  at: number;
  kind: JournalKind;
  data: Record<string, unknown>;
}
