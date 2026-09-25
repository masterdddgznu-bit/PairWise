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
    // Transitively invalidate every downstream step: cached results are
    // dropped and succeeded steps must recompute against the new generation.
    const visited = new Set<string>([rootId]);
    const queue = [...graph.dependents(rootId)];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      this.cache.invalidate(runId, id);
      const st = steps[id];
      if (st.state === "succeeded") {
        st.state = "pending";
        st.result = undefined;
        st.lastError = undefined;
      }
      queue.push(...graph.dependents(id));
    }
  }
}
