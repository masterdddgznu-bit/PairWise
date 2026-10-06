import { EscrowErrorCode, fail } from "./errors";

export function requireSafeInteger(
  value: unknown,
  code: EscrowErrorCode,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(code, `${field} must be a safe integer`);
  }
  return value;
}

export function requirePositive(
  value: unknown,
  code: EscrowErrorCode,
  field: string,
): number {
  const parsed = requireSafeInteger(value, code, field);
  if (parsed <= 0) {
    fail(code, `${field} must be a positive safe integer`);
  }
  return parsed;
}

export function requireAmount(value: unknown): number {
  return requirePositive(value, "INVALID_AMOUNT", "amount");
}

export function requireTimestamp(value: unknown): number {
  return requireSafeInteger(value, "INVALID_TIME", "at");
}

export function requireNonEmptyString(
  value: unknown,
  code: EscrowErrorCode,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(code, `${field} must be a non-empty string`);
  }
  return value;
}
