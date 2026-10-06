export type TrustRollErrorCode =
  | "TENANT_EXISTS"
  | "UNKNOWN_TENANT"
  | "CROSS_TENANT_IDENTITY"
  | "SERIAL_EXISTS"
  | "UNKNOWN_CERTIFICATE"
  | "ROTATION_ACTIVE"
  | "NO_ACTIVE_ROTATION"
  | "ANCHOR_REGRESSION"
  | "ACK_REGRESSION"
  | "UNKNOWN_REVISION"
  | "UNKNOWN_COHORT"
  | "BUNDLE_BARRIER"
  | "UNKNOWN_OBLIGATION"
  | "STALE_CLAIM"
  | "LEASE_EXPIRED"
  | "LINEAGE_CONFLICT"
  | "LIVE_OLD_CERTIFICATE"
  | "OPEN_OBLIGATIONS"
  | "UNPUBLISHED_REVOCATION"
  | "CAPACITY_WAL"
  | "CAPACITY_CERTIFICATES"
  | "CAPACITY_OBLIGATIONS"
  | "JOURNAL_GAP"
  | "JOURNAL_TIME"
  | "JOURNAL_PHASE"
  | "JOURNAL_LINEAGE";

export class TrustRollError extends Error {
  readonly code: TrustRollErrorCode;

  constructor(code: TrustRollErrorCode, message: string) {
    super(message);
    this.name = "TrustRollError";
    this.code = code;
  }
}
