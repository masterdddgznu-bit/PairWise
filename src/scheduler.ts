import type { StepDef, StepRuntime } from "./types.js";
import { Graph } from "./graph.js";

export class Scheduler {
  constructor(private graph: Graph) {}

  runnable(steps: Record<string, StepRuntime>, defs: StepDef[]): string[] {
    const defMap = new Map(defs.map((d) => [d.id, d]));
    const out: string[] = [];
    for (const id of this.graph.ids()) {
      const st = steps[id];
      if (st.state === "failed" && st.nextRetryAt !== undefined) continue;
      const ready = this.graph.isReady(
        id,
        (x) => steps[x].state,
        (x) => steps[x].generation,
        (dep) => {
          // expected input generation = dep's result generation
          return steps[dep].result?.generation ?? steps[dep].generation;
        },
      );
      if (ready) out.push(id);
      void defMap;
    }
    return out;
  }
}
