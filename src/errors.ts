export type EscrowErrorCode =
  | "INVALID_CAPACITY"
  | "INVALID_QUOTA"
  | "INVALID_AMOUNT"
  | "INVALID_TIME"
  | "INVALID_EPOCH"
  | "INVALID_LEASE"
  | "INVALID_NONCE"
  | "INVALID_IDENTITY"
  | "INVALID_TENANT"
  | "INVALID_REGION"
  | "INVALID_JOURNAL"
  | "QUOTA_SPLIT"
  | "DUPLICATE_TENANT"
  | "GLOBAL_CAPACITY"
  | "UNKNOWN_TENANT"
  | "UNKNOWN_REGION"
  | "UNKNOWN_TRANSFER"
  | "UNKNOWN_RESERVATION"
  | "SELF_TRANSFER"
  | "TRANSFER_CONFLICT"
  | "TRANSFER_TOKEN"
  | "TRANSFER_PHASE"
  | "STALE_EPOCH"
  | "STALE_OWNER"
  | "STALE_FENCE"
  | "LOCAL_CAPACITY"
  | "RESERVATION_PHASE"
  | "LEASE_EXPIRED"
  | "LEASE_NOT_EXPIRED"
  | "JOURNAL_GAP"
  | "FUTURE_JOURNAL"
  | "DUPLICATE_MUTATION"
  | "JOURNAL_MISMATCH"
  | "UNKNOWN_JOURNAL_KIND";

export class EscrowError extends Error {
  readonly code: EscrowErrorCode;

  constructor(code: EscrowErrorCode, message: string) {
    super(message);
    this.name = "EscrowError";
    this.code = code;
    Object.setPrototypeOf(this, EscrowError.prototype);
  }
}

export function fail(code: EscrowErrorCode, message: string): never {
  throw new EscrowError(code, message);
}
