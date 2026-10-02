import { SagaError } from "./errors.js";
import type { SagaRuntime } from "./types.js";

export function requireRunnable(runtime: SagaRuntime): void {
  if (runtime.status === "completed" || runtime.status === "failed") {
    throw new SagaError(`saga is ${runtime.status}`);
  }
}

export function requireObject(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SagaError("state must be an object");
  }
}
