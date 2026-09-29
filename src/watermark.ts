import type { Side } from "./types.js";

/** Per-side event-time watermark — starter stub. */
export class SideWatermark {
  value(_side: Side): number {
    throw new Error("watermark not implemented");
  }

  observe(_side: Side, _eventTime: number, _maxLatenessMs: number): void {
    throw new Error("watermark observe not implemented");
  }

  advance(_side: Side, _wm: number): void {
    throw new Error("watermark advance not implemented");
  }
}
