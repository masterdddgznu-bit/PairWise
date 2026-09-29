import type { Side } from "./types.js";

/**
 * Per-side event-time watermark.
 *
 * The effective watermark is the max of:
 * - the highest observed eventTime minus maxLatenessMs;
 * - any explicitly advanced value.
 *
 * A side with no data reports 0; the value is monotone non-decreasing.
 */
export class SideWatermark {
  private readonly maxEventTime: Record<Side, number | null> = {
    L: null,
    R: null,
  };

  private readonly observed: Record<Side, number> = { L: 0, R: 0 };
  private readonly explicit: Record<Side, number> = { L: 0, R: 0 };

  value(side: Side): number {
    return Math.max(this.observed[side], this.explicit[side]);
  }

  observe(side: Side, eventTime: number, maxLatenessMs: number): void {
    const prev = this.maxEventTime[side];
    this.maxEventTime[side] =
      prev === null ? eventTime : Math.max(prev, eventTime);
    this.observed[side] = Math.max(
      0,
      (this.maxEventTime[side] as number) - maxLatenessMs,
    );
  }

  advance(side: Side, wm: number): void {
    this.explicit[side] = Math.max(this.explicit[side], wm);
  }
}
