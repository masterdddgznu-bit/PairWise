import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import type { Emit, IngestResult, LateEvent, WaterMeshOptions } from "./types.js";

export class WaterMesh {
  readonly clock: VirtualClock;

  constructor(opts: WaterMeshOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    this.clock = opts.clock;
  }

  watermark(): number {
    return Number.NEGATIVE_INFINITY;
  }

  ingest(_key: string, _eventTime: number, _payload: string): IngestResult {
    return "drop";
  }

  raiseWatermark(_wm: number): Emit[] {
    return [];
  }

  pollResults(): Emit[] {
    return [];
  }

  pollLate(): LateEvent[] {
    return [];
  }

  openWindowCount(): number {
    return 0;
  }

  closedWindowCount(): number {
    return 0;
  }

  checkpoint(): string {
    return "{}";
  }

  restore(_json: string): void {}
}
