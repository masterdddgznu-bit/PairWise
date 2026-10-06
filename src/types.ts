export interface Limits {
  certificates?: number;
  obligations?: number;
  wal?: number;
}

export type ObligationState = "pending" | "leased" | "completed" | "cancelled";

export interface RotationView {
  target: number;
  revision: number;
  requiredCohorts: string[];
  acknowledged: string[];
}

export interface CertificateView {
  serial: string;
  identity: string;
  anchorGeneration: number;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
  replaces: string | null;
  replacedBy: string | null;
}

export interface ObligationView {
  obligationId: string;
  sourceSerial: string;
  state: ObligationState;
  claimant: string | null;
  fence: number;
  leaseExpiresAt: number | null;
}

export interface TenantView {
  trustedGenerations: number[];
  issuanceGeneration: number;
  rotation: RotationView | null;
  certificates: CertificateView[];
  obligations: ObligationView[];
}

export interface Claim {
  obligationId: string;
  tenant: string;
  sourceSerial: string;
  agent: string;
  fence: number;
  leaseExpiresAt: number;
}

export interface Bundle {
  revision: number;
  generations: number[];
}

export interface RotationSnapshot {
  target: number;
  revision: number;
  requiredCohorts: string[];
  acknowledged: string[];
}

export interface AnchorSnapshot {
  trusted: number[];
  issuance: number;
  cohorts: string[];
  nextRevision: number;
  rotation: RotationSnapshot | null;
}

export interface CertificateSnapshot {
  serial: string;
  identity: string;
  anchorGeneration: number;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
  replaces: string | null;
  replacedBy: string | null;
}

export interface CertificatesSnapshot {
  tenants: [string, [string, CertificateSnapshot][]][];
  identities: [string, string][];
}

export interface ObligationSnapshot {
  id: string;
  sourceSerial: string;
  state: ObligationState;
  claimant: string | null;
  fence: number;
  leaseExpiresAt: number | null;
}

export interface ObligationsSnapshot {
  tenants: [string, ObligationSnapshot[]][];
  nextId: number;
  fence: number;
}

export interface RevocationSnapshot {
  unpublished: string[];
  published: string[];
}

export interface StateSnapshot {
  anchors: [string, AnchorSnapshot][];
  certificates: CertificatesSnapshot;
  obligations: ObligationsSnapshot;
  revocations: [string, RevocationSnapshot][];
}

export type WalPayload = Record<string, unknown>;

export interface JournalEntry {
  seq: number;
  at: number;
  payload: WalPayload;
  state: StateSnapshot;
}
