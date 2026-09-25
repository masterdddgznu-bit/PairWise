import type { StepDef } from "./types.js";
import { Graph } from "./graph.js";

/**
 * Builds compensation order for succeeded steps in a cancel/rollback path.
 */
export class Compensator {
  order(steps: StepDef[], onlyIds: string[]): string[] {
    const g = new Graph(steps);
    const order = g.reverseTopo();
    return order.filter((id) => onlyIds.includes(id));
  }

  label(step: StepDef): string {
    return step.compensate ?? `undo:${step.id}`;
  }
}
