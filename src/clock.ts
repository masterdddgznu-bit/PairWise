import { PitchKettleError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new PitchKettleError("advance requires a finite ms >= 0");
    }
    this.current += ms;
  }
}
