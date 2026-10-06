import { EscrowError, type ErrorCode } from "./errors";

export function assertPositiveInt(value: unknown, code: ErrorCode, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new EscrowError(code, `${label} must be a positive safe integer`);
  }
}

export function assertNonNegativeInt(value: unknown, code: ErrorCode, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new EscrowError(code, `${label} must be a non-negative safe integer`);
  }
}

export function assertNonEmptyString(value: unknown, code: ErrorCode, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new EscrowError(code, `${label} must be a non-empty string`);
  }
}

export function assertSafeSum(value: number, code: ErrorCode, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new EscrowError(code, `${label} overflows safe integer range`);
  }
}
