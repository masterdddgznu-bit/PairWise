import type { VirtualClock } from "./clock.js";

/** Tracks watermark for window closing — periodic advance on tick. */
export class WatermarkTracker {
  private maxEventTime = 0;

  constructor(
    private readonly clock: VirtualClock,
    private readonly allowedLateness: number,
  ) {}

  observe(eventTime: number): void {
    if (eventTime > this.maxEventTime) {
      this.maxEventTime = eventTime;
    }
  }

  /** Current watermark used to close windows. */
  watermark(): number {
    return Math.max(0, this.maxEventTime - this.allowedLateness);
  }

  maxObserved(): number {
    return this.maxEventTime;
  }

  restore(maxEventTime: number): void {
    this.maxEventTime = maxEventTime;
  }
}
