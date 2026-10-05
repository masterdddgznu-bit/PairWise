import { PartWinError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new PartWinError("advance(ms) requires ms >= 0");
    }
    this.current += ms;
  }
}
