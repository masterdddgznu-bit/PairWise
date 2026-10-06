export type ErrorCode =
  | "INVALID_CAPACITY"
  | "INVALID_QUOTA"
  | "INVALID_AMOUNT"
  | "INVALID_EPOCH"
  | "INVALID_TIME"
  | "INVALID_TENANT"
  | "TENANT_EXISTS"
  | "DUPLICATE_REGION"
  | "UNKNOWN_TENANT"
  | "UNKNOWN_REGION"
  | "UNKNOWN_TRANSFER"
  | "UNKNOWN_RESERVATION"
  | "GLOBAL_CAPACITY"
  | "QUOTA_SPLIT"
  | "LOCAL_CAPACITY"
  | "SELF_TRANSFER"
  | "TRANSFER_CONFLICT"
  | "TRANSFER_PHASE"
  | "TRANSFER_TOKEN"
  | "STALE_EPOCH"
  | "STALE_OWNER"
  | "STALE_FENCE"
  | "LEASE_EXPIRED"
  | "RESERVATION_PHASE"
  | "JOURNAL_GAP"
  | "FUTURE_JOURNAL"
  | "DUPLICATE_MUTATION"
  | "JOURNAL_INVALID";

export class EscrowError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "EscrowError";
    this.code = code;
  }
}
