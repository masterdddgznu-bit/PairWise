import type { GKTuple } from "./types.js";

/** GK compress — deterministic right-to-left sweep; never merges head/tail. */
export function compressTuples(tuples: GKTuple[], epsilon: number, count: number): GKTuple[] {
  const threshold = 2 * epsilon * count;
  for (let i = tuples.length - 2; i >= 1; i -= 1) {
    const current = tuples[i]!;
    const next = tuples[i + 1]!;
    if (current.g + next.g + next.delta < threshold) {
      next.g += current.g;
      tuples.splice(i, 1);
    }
  }
  return tuples;
}
