import { SpanOwnError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
      throw new SpanOwnError("advance requires a finite number");
    }
    if (ms < 0) {
      throw new SpanOwnError("cannot advance clock backwards");
    }
    this.current += ms;
  }
}
