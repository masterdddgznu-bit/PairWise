export interface CoordinatorLimits {
  certificates?: number;
  obligations?: number;
  wal?: number;
}

export type ObligationState = "pending" | "leased" | "completed" | "cancelled";

export interface RotationSnapshot {
  target: number;
  revision: number;
  requiredCohorts: string[];
  acknowledged: string[];
}

export interface AnchorSnapshot {
  issuance: number;
  trusted: number[];
  cohorts: string[];
  revision: number;
  rotation: RotationSnapshot | null;
}

export interface CertificateSnapshot {
  serial: string;
  service: string;
  anchorGeneration: number;
  expiresAt: number;
  revoked: boolean;
  replaces: string | null;
  replacedBy: string | null;
}

export interface ObligationSnapshot {
  id: string;
  tenant: string;
  sourceSerial: string;
  state: ObligationState;
  agent: string | null;
  fence: number;
  leaseExpiresAt: number | null;
}

export interface RevocationSnapshot {
  unpublished: string[];
  published: string[];
}

export interface CertificateStoreSnapshot {
  tenants: [string, [string, CertificateSnapshot][]][];
  services: [string, string][];
}

export interface CoordinatorSnapshot {
  anchors: [string, AnchorSnapshot][];
  certificates: CertificateStoreSnapshot;
  obligations: [string, ObligationSnapshot[]][];
  revocations: [string, RevocationSnapshot][];
  fence: number;
  nextObligationId: number;
}

export interface JournalEntry {
  seq: number;
  at: number;
  type: string;
  payload: unknown;
  state: CoordinatorSnapshot;
}

export interface CertificateView {
  serial: string;
  service: string;
  anchorGeneration: number;
  expiresAt: number;
  revoked: boolean;
  replaces: string | null;
  replacedBy: string | null;
}

export interface ObligationView {
  obligationId: string;
  sourceSerial: string;
  state: ObligationState;
  agent: string | null;
  fence: number;
  leaseExpiresAt: number | null;
}

export interface RotationView {
  target: number;
  revision: number;
  requiredCohorts: string[];
  acknowledged: string[];
}

export interface TenantView {
  trustedGenerations: number[];
  issuanceGeneration: number;
  cohorts: string[];
  revision: number;
  rotation: RotationView | null;
  certificates: CertificateView[];
  obligations: ObligationView[];
  unpublishedRevocations: string[];
}

export interface BundleView {
  revision: number;
  generations: number[];
}

export interface ClaimTicket {
  obligationId: string;
  fence: number;
}
