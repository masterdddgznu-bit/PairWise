import type { VirtualClock } from "./clock.js";
import type { Event, JoinOut, Side } from "./types.js";

/** Event-time interval join with per-side watermarks. */
export class SpanJoin {
  constructor(
    _clock: VirtualClock,
    _spanMs: number,
    _maxLatenessMs: number,
  ) {}

  ingestLeft(_e: Event): void {
    throw new Error("ingestLeft not implemented");
  }

  ingestRight(_e: Event): void {
    throw new Error("ingestRight not implemented");
  }

  advanceWatermark(_side: Side, _wm: number): void {
    throw new Error("advanceWatermark not implemented");
  }

  watermark(_side: Side): number {
    throw new Error("watermark not implemented");
  }

  earlyFire(_procDeadline: number): void {
    throw new Error("earlyFire not implemented");
  }

  results(): JoinOut[] {
    throw new Error("results not implemented");
  }

  lateOutput(): Event[] {
    throw new Error("lateOutput not implemented");
  }

  buffered(_side: Side): number {
    throw new Error("buffered not implemented");
  }
}
