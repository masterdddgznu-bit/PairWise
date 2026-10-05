import { SpanLeaseError } from "./errors.js";

export class VirtualClock {
  private current: number;

  constructor(start = 0) {
    if (!Number.isFinite(start)) {
      throw new SpanLeaseError("clock start must be a finite number");
    }
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new SpanLeaseError("advance requires a finite ms >= 0");
    }
    this.current += ms;
  }
}
