import type { Side } from "./types.js";

/** Per-side event-time watermark tracking. */
export class SideWatermark {
  private readonly maxEventTime = new Map<Side, number>();
  private readonly advancedTo = new Map<Side, number>();

  constructor(private readonly maxLatenessMs: number) {}

  /** Current watermark for a side: max(auto from events, explicit advance). */
  value(side: Side): number {
    const auto = this.autoValue(side);
    const explicit = this.advancedTo.get(side) ?? 0;
    return Math.max(auto, explicit);
  }

  /** Fold an observed event time into the side's auto watermark. */
  observe(side: Side, eventTime: number): void {
    const prev = this.maxEventTime.get(side) ?? Number.NEGATIVE_INFINITY;
    if (eventTime > prev) {
      this.maxEventTime.set(side, eventTime);
    }
  }

  /** Monotone non-decreasing explicit watermark advance. */
  advance(side: Side, wm: number): void {
    const prev = this.advancedTo.get(side) ?? 0;
    if (wm > prev) {
      this.advancedTo.set(side, wm);
    }
  }

  private autoValue(side: Side): number {
    const maxEt = this.maxEventTime.get(side);
    if (maxEt === undefined) {
      return 0;
    }
    return maxEt - this.maxLatenessMs;
  }
}
