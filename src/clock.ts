import { CriaderaError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new CriaderaError("advance amount must be a finite number >= 0");
    }
    this.current += ms;
  }
}
