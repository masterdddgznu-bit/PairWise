import { SpargeArmError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new SpargeArmError("advance requires a finite, non-negative delta");
    }
    this.current += ms;
  }
}
