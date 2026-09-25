import type { StepDef } from "./types.js";

export class RetryPolicy {
  delays(step: StepDef): number[] {
    return step.retryDelays ? [...step.retryDelays] : [];
  }

  /** Next retry tick, or undefined if exhausted. */
  schedule(step: StepDef, attempt: number, now: number): number | undefined {
    const d = this.delays(step);
    if (attempt >= d.length) return undefined;
    return now + d[attempt];
  }
}
