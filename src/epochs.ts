import type { VirtualClock } from "./clock.js";
import type { WaitStatus } from "./types.js";

/** Absolute-deadline registry for epoch waits, driven by an injected clock. */
export class WaitRegistry {
  private readonly deadlines = new Map<number, number>();

  constructor(private readonly clock: VirtualClock) {}

  register(_epoch: number, _deadlineMs: number): void {
    this.deadlines.set(_epoch, this.clock.now() + _deadlineMs);
  }

  status(_epoch: number, _allReady: boolean): WaitStatus {
    if (_allReady) {
      return "ready";
    }
    const deadline = this.deadlines.get(_epoch);
    if (deadline !== undefined && this.clock.now() >= deadline) {
      return "timedout";
    }
    return "pending";
  }

  tick(): void {
    // Deadlines are evaluated lazily against the injected clock in `status`.
  }
}
