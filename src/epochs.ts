import type { VirtualClock } from "./clock.js";
import type { WaitStatus } from "./types.js";

/** Per-epoch wait deadlines registered against the injected clock. */
export class WaitRegistry {
  private readonly clock: VirtualClock;
  private readonly deadlines = new Map<number, number>();
  private readonly timedOutEpochs = new Set<number>();

  constructor(clock: VirtualClock) {
    this.clock = clock;
  }

  register(_epoch: number, _deadlineMs: number): void {
    const absolute = this.clock.now() + _deadlineMs;
    this.deadlines.set(_epoch, absolute);
    if (this.clock.now() >= absolute) {
      this.timedOutEpochs.add(_epoch);
    }
  }

  status(_epoch: number, _allReady: boolean): WaitStatus {
    if (_allReady) {
      return "ready";
    }
    const deadline = this.deadlines.get(_epoch);
    if (
      deadline !== undefined &&
      (this.timedOutEpochs.has(_epoch) || this.clock.now() >= deadline)
    ) {
      this.timedOutEpochs.add(_epoch);
      return "timedout";
    }
    return "pending";
  }

  tick(): void {
    const now = this.clock.now();
    for (const [epoch, deadline] of this.deadlines) {
      if (now >= deadline) {
        this.timedOutEpochs.add(epoch);
      }
    }
  }
}
