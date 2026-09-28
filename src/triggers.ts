import type { Agg } from "./types.js";

export class ProcessingTriggers {
  arm(_windowStart: number, _fireAt: number): void {
    throw new Error("triggers not implemented");
  }

  tick(_now: number, _snap: (start: number) => Agg[] | null): void {
    throw new Error("triggers tick not implemented");
  }

  get(_windowStart: number): Agg[] | null {
    return null;
  }
}
