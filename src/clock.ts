import { NestLeaseError } from "./errors.js";

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new NestLeaseError(`cannot advance clock by ${ms}`);
    }
    this.current += ms;
  }
}
