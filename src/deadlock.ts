import { DeadlockError } from "./errors.js";

/**
 * Add waits-for edge(s) from `from` to every txn in `toList`, then verify
 * that no cycle is created. If a cycle forms, every added edge is rolled
 * back and a DeadlockError is thrown.
 */
export function assertNoDeadlock(
  waitsFor: Map<string, Set<string>>,
  from: string,
  toList: string[],
): void {
  const added: string[] = [];
  let edges = waitsFor.get(from);
  if (!edges) {
    edges = new Set<string>();
    waitsFor.set(from, edges);
  }
  for (const to of toList) {
    if (to === from || edges.has(to)) continue;
    edges.add(to);
    added.push(to);
  }

  if (hasCycle(waitsFor, from)) {
    for (const to of added) edges.delete(to);
    if (edges.size === 0) waitsFor.delete(from);
    throw new DeadlockError(`deadlock: ${from} waits on ${[...added].join(",")}`);
  }
}

/** DFS cycle reachability: can `start` reach itself following waits-for edges? */
export function hasCycle(
  waitsFor: Map<string, Set<string>>,
  start: string,
): boolean {
  const seen = new Set<string>();
  const stack: string[] = [start];
  let first = true;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === start && !first) return true;
    first = false;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of waitsFor.get(cur) ?? []) {
      stack.push(next);
    }
  }
  return false;
}
