import { SpargeArmError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new SpargeArmError("advance requires a finite number >= 0");
    }
    this.current += ms;
  }
}
