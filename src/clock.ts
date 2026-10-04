import { OrderMuxError } from "./errors.js";

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new OrderMuxError("advance(ms) requires a finite number >= 0");
    }
    this.t += ms;
  }
}
