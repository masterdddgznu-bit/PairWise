import type { StepResult } from "./types.js";

/**
 * Result cache keyed by run / step / generation.
 */
export class ResultCache {
  private map = new Map<string, StepResult>();

  private key(runId: string, stepId: string, generation: number): string {
    return `${runId}:${stepId}:${generation}`;
  }

  set(runId: string, stepId: string, result: StepResult): void {
    this.map.set(this.key(runId, stepId, result.generation), { ...result });
  }

  get(runId: string, stepId: string, generation: number): StepResult | undefined {
    const v = this.map.get(this.key(runId, stepId, generation));
    if (!v) return undefined;
    return { ...v };
  }

  invalidate(runId: string, stepId: string, generation?: number): void {
    if (generation === undefined) {
      const prefix = `${runId}:${stepId}:`;
      for (const k of [...this.map.keys()]) {
        if (k.startsWith(prefix)) this.map.delete(k);
      }
      return;
    }
    this.map.delete(this.key(runId, stepId, generation));
  }

  invalidateRun(runId: string): void {
    for (const k of [...this.map.keys()]) {
      if (k.startsWith(`${runId}:`)) this.map.delete(k);
    }
  }
}
