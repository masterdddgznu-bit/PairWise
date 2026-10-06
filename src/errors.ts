export type TrustRollErrorCode =
  | "TENANT_EXISTS"
  | "TENANT_UNKNOWN"
  | "CROSS_TENANT_IDENTITY"
  | "SERIAL_EXISTS"
  | "UNKNOWN_CERTIFICATE"
  | "ALREADY_REVOKED"
  | "GENERATION_EXISTS"
  | "ROTATION_ACTIVE"
  | "NO_ROTATION"
  | "UNKNOWN_REVISION"
  | "UNKNOWN_COHORT"
  | "ACK_REGRESSION"
  | "BUNDLE_BARRIER"
  | "LEASE_EXPIRED"
  | "STALE_CLAIM"
  | "LIVE_OLD_CERTIFICATE"
  | "OBLIGATIONS_PENDING"
  | "UNPUBLISHED_REVOCATION"
  | "NO_RETIREABLE_ANCHOR"
  | "CAPACITY_CERTIFICATES"
  | "CAPACITY_OBLIGATIONS"
  | "CAPACITY_WAL"
  | "JOURNAL_GAP"
  | "JOURNAL_TIME"
  | "JOURNAL_PHASE"
  | "JOURNAL_LINEAGE";

export class TrustRollError extends Error {
  readonly code: TrustRollErrorCode;

  constructor(code: TrustRollErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TrustRollError";
    this.code = code;
  }
}
