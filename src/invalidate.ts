import type { StepRuntime } from "./types.js";
import { Graph } from "./graph.js";
import type { ResultCache } from "./cache.js";

/**
 * Propagate invalidation to dependents when a step generation bumps.
 */
export class Invalidator {
  constructor(private cache: ResultCache) {}

  bumpAndInvalidate(
    runId: string,
    graph: Graph,
    steps: Record<string, StepRuntime>,
    rootId: string,
  ): void {
    const root = steps[rootId];
    root.generation += 1;
    root.result = undefined;
    this.cache.invalidate(runId, rootId);
    // Only touches direct dependents today; deeper DAG nodes may keep old results.
    for (const dep of graph.dependents(rootId)) {
      this.cache.invalidate(runId, dep);
      if (steps[dep].state === "succeeded") {
        // state/result left as-is
      }
    }
  }
}
