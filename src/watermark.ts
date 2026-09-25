import type { VirtualClock } from "./clock.js";

/**
 * Tracks the event-time watermark for window closing.
 *
 * The watermark is derived purely from observed event times
 * (W = max(0, maxObservedEventTime - allowedLateness)); the logical clock is
 * retained for ingest/tick ordering but never drives event time.
 */
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
