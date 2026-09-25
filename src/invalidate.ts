import type { StepRuntime } from "./types.js";
import { Graph } from "./graph.js";
import type { ResultCache } from "./cache.js";
import type { StateMachine } from "./state_machine.js";

/**
 * Propagate invalidation to dependents when a step generation bumps.
 */
export class Invalidator {
  constructor(
    private cache: ResultCache,
    private sm: StateMachine,
  ) {}

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

    // Propagate transitively: every committed downstream result was derived
    // from the root's previous generation and must be recomputed.
    const queue = [...graph.dependents(rootId)];
    const seen = new Set<string>(queue);
    while (queue.length) {
      const id = queue.shift()!;
      const node = steps[id];
      this.cache.invalidate(runId, id);
      if (node.state === "succeeded") {
        node.state = this.sm.transition(node.state, "pending", false);
        node.generation += 1;
        node.result = undefined;
      }
      for (const child of graph.dependents(id)) {
        if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
      }
    }
  }
}
