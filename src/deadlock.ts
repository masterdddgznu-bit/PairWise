import { DeadlockError } from "./errors.js";

/** Starter stub. */
export function assertNoDeadlock(
  _waitsFor: Map<string, Set<string>>,
  _from: string,
  _toList: string[],
): void {
  void DeadlockError;
  throw new Error("deadlock check not implemented");
}
