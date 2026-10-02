import { DeadlockError } from "./errors.js";

/**
 * BUG: never detects cycles — always accepts edges.
 */
export function assertNoDeadlock(
  graph: Map<string, Set<string>>,
  from: string,
  toList: string[],
): void {
  if (!graph.has(from)) graph.set(from, new Set());
  for (const t of toList) graph.get(from)!.add(t);
  void DeadlockError;
}
