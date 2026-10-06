import { StateError } from "./errors.js";

export function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StateError(`${label} must be a non-empty string`);
  }
}
