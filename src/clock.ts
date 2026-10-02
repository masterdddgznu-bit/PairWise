import { SagaError } from "./errors.js";

export class VirtualClock {
  private value = 0;

  now(): number {
    return this.value;
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) throw new SagaError("invalid tick");
    this.value += ms;
    return this.value;
  }

  restore(value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new SagaError("invalid clock");
    this.value = value;
  }
}
