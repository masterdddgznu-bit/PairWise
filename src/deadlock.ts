import { DeadlockError } from "./errors.js";

/**
 * Waits-for graph: edge waiter -> holder means `waiter` is blocked and can
 * only proceed once `holder` releases. A cycle is a deadlock.
 */
export type WaitsFor = Map<string, Set<string>>;

export function createWaitsFor(): WaitsFor {
  return new Map();
}

/**
 * Replace all outgoing edges of `from` with `toList` (deduplicated), then
 * verify no cycle is reachable from `from`. Throws DeadlockError without
 * mutating the graph when a cycle would form.
 */
export function assertNoDeadlock(
  waitsFor: WaitsFor,
  from: string,
  toList: string[],
): void {
  const targets = new Set(toList.filter((t) => t !== from));

  if (reaches(waitsFor, targets, from)) {
    throw new DeadlockError(`deadlock: ${from} waits in a cycle`);
  }

  if (targets.size === 0) {
    waitsFor.delete(from);
  } else {
    waitsFor.set(from, targets);
  }
}

/**
 * Replace outgoing edges without running the cycle check. Used while pumping
 * granted waiters: the request was already admitted earlier, and its
 * ancestors may already be held (rollback would contradict the spec).
 */
export function setEdges(
  waitsFor: WaitsFor,
  from: string,
  toList: string[],
): void {
  const targets = new Set(toList.filter((t) => t !== from));
  if (targets.size === 0) {
    waitsFor.delete(from);
  } else {
    waitsFor.set(from, targets);
  }
}

export function removeWaiter(waitsFor: WaitsFor, txn: string): void {
  waitsFor.delete(txn);
  for (const targets of waitsFor.values()) {
    targets.delete(txn);
  }
}

/** Is `goal` reachable from any node in `starts` following graph edges? */
function reaches(
  waitsFor: WaitsFor,
  starts: Set<string>,
  goal: string,
): boolean {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === goal) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of waitsFor.get(node) ?? []) {
      stack.push(next);
    }
  }
  return false;
}
